#!/usr/bin/env npx tsx
/**
 * Archive Audit Logs Script
 *
 * Archives audit log records older than 12 months to S3, then deletes them from PostgreSQL.
 * Maintains hash chain continuity via archive_checkpoint table.
 *
 * ARCHITECTURE:
 * - CloudWatch Logs (1096 days) is the authoritative store for AU-9/AU-11 compliance
 * - PostgreSQL retains 12 months for fast queries
 * - This script archives records older than 12 months to S3, then deletes from PostgreSQL
 *
 * SAFETY:
 * - Verifies CloudWatch has records before deleting from PostgreSQL
 * - Uses transaction with trigger disable/enable
 * - Creates archive_checkpoint for hash chain continuity
 * - Logs 'audit.records_archived' event before deletion
 *
 * Usage:
 *   npx tsx scripts/archive-audit-logs.ts [options]
 *
 * Options:
 *   --dry-run           Show what would be archived without making changes
 *   --months=N          Archive records older than N months (default: 12)
 *   --workspace-id=UUID Only archive records for a specific workspace
 *   --skip-cloudwatch   Skip CloudWatch verification (DANGEROUS - only for recovery)
 *   --batch-size=N      Process records in batches of N (default: 1000)
 *
 * Environment:
 *   DATABASE_URL              PostgreSQL connection string (required)
 *   AWS_REGION                AWS region (default: us-east-1)
 *   CLOUDWATCH_AUDIT_LOG_GROUP CloudWatch log group (required unless --skip-cloudwatch)
 *   S3_AUDIT_ARCHIVE_BUCKET   S3 bucket for archives (required unless --dry-run)
 */

import { Pool, PoolClient } from 'pg';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { CloudWatchLogsClient, FilterLogEventsCommand } from '@aws-sdk/client-cloudwatch-logs';
import crypto from 'crypto';

// Parse command line arguments
const args = process.argv.slice(2);
const options = {
  dryRun: args.includes('--dry-run'),
  months: parseInt(args.find(a => a.startsWith('--months='))?.split('=')[1] || '12'),
  workspaceId: args.find(a => a.startsWith('--workspace-id='))?.split('=')[1],
  skipCloudWatch: args.includes('--skip-cloudwatch'),
  batchSize: parseInt(args.find(a => a.startsWith('--batch-size='))?.split('=')[1] || '1000'),
};

// Validate environment
const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error('ERROR: DATABASE_URL environment variable is required');
  process.exit(1);
}

const AWS_REGION = process.env.AWS_REGION || 'us-east-1';
const CLOUDWATCH_LOG_GROUP = process.env.CLOUDWATCH_AUDIT_LOG_GROUP;
const S3_BUCKET = process.env.S3_AUDIT_ARCHIVE_BUCKET;

if (!options.skipCloudWatch && !CLOUDWATCH_LOG_GROUP) {
  console.error('ERROR: CLOUDWATCH_AUDIT_LOG_GROUP is required unless --skip-cloudwatch is specified');
  process.exit(1);
}

if (!options.dryRun && !S3_BUCKET) {
  console.error('ERROR: S3_AUDIT_ARCHIVE_BUCKET is required unless --dry-run is specified');
  process.exit(1);
}

// Initialize clients
const pool = new Pool({ connectionString: DATABASE_URL });
const s3Client = new S3Client({ region: AWS_REGION });
const cloudwatchClient = new CloudWatchLogsClient({ region: AWS_REGION });

interface AuditRecord {
  id: string;
  workspace_id: string;
  actor_user_id: string;
  action: string;
  resource_type: string;
  resource_id: string;
  details: object;
  ip_address: string;
  user_agent: string;
  created_at: Date;
  record_hash: string;
  previous_hash: string;
}

/**
 * Verify records exist in CloudWatch before deleting from PostgreSQL
 */
async function verifyCloudWatchRecords(
  recordIds: string[],
  startTime: Date,
  endTime: Date
): Promise<boolean> {
  if (options.skipCloudWatch || !CLOUDWATCH_LOG_GROUP) {
    console.warn('WARNING: Skipping CloudWatch verification');
    return true;
  }

  console.log(`Verifying ${recordIds.length} records exist in CloudWatch...`);

  // Sample check: verify a few records exist in CloudWatch
  const sampleSize = Math.min(10, recordIds.length);
  const sampleIds = recordIds.slice(0, sampleSize);

  for (const id of sampleIds) {
    try {
      const response = await cloudwatchClient.send(new FilterLogEventsCommand({
        logGroupName: CLOUDWATCH_LOG_GROUP,
        filterPattern: `{ $.id = "${id}" }`,
        startTime: startTime.getTime(),
        endTime: endTime.getTime() + 86400000, // Add 1 day buffer
        limit: 1,
      }));

      if (!response.events || response.events.length === 0) {
        console.error(`ERROR: Record ${id} not found in CloudWatch`);
        return false;
      }
    } catch (error) {
      console.error(`ERROR: Failed to verify record ${id} in CloudWatch:`, error);
      return false;
    }
  }

  console.log(`✓ CloudWatch verification passed (${sampleSize} records sampled)`);
  return true;
}

/**
 * Archive records to S3
 */
async function archiveToS3(
  records: AuditRecord[],
  workspaceId: string | null
): Promise<{ location: string; checksum: string }> {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const key = workspaceId
    ? `audit-archives/${workspaceId}/${timestamp}.jsonl`
    : `audit-archives/cross-workspace/${timestamp}.jsonl`;

  // Convert records to JSONL format
  const jsonl = records.map(r => JSON.stringify(r)).join('\n');
  const checksum = crypto.createHash('sha256').update(jsonl).digest('hex');

  if (options.dryRun) {
    console.log(`[DRY RUN] Would upload ${records.length} records to s3://${S3_BUCKET}/${key}`);
    return { location: `s3://${S3_BUCKET}/${key}`, checksum };
  }

  await s3Client.send(new PutObjectCommand({
    Bucket: S3_BUCKET!,
    Key: key,
    Body: jsonl,
    ContentType: 'application/x-ndjson',
    Metadata: {
      'record-count': String(records.length),
      'checksum-sha256': checksum,
      'archived-at': new Date().toISOString(),
    },
  }));

  console.log(`✓ Uploaded ${records.length} records to s3://${S3_BUCKET}/${key}`);
  return { location: `s3://${S3_BUCKET}/${key}`, checksum };
}

/**
 * Delete archived records from PostgreSQL
 */
async function deleteArchivedRecords(
  client: PoolClient,
  recordIds: string[]
): Promise<void> {
  if (options.dryRun) {
    console.log(`[DRY RUN] Would delete ${recordIds.length} records from PostgreSQL`);
    return;
  }

  // Disable immutability triggers
  await client.query('ALTER TABLE audit_logs DISABLE TRIGGER audit_no_delete');

  // Delete in batches
  for (let i = 0; i < recordIds.length; i += options.batchSize) {
    const batch = recordIds.slice(i, i + options.batchSize);
    await client.query(
      `DELETE FROM audit_logs WHERE id = ANY($1::uuid[])`,
      [batch]
    );
    console.log(`  Deleted batch ${Math.floor(i / options.batchSize) + 1}/${Math.ceil(recordIds.length / options.batchSize)}`);
  }

  // Re-enable triggers
  await client.query('ALTER TABLE audit_logs ENABLE TRIGGER audit_no_delete');
}

/**
 * Main archival process
 */
async function main() {
  console.log('='.repeat(60));
  console.log('AUDIT LOG ARCHIVAL');
  console.log('='.repeat(60));
  console.log(`Mode: ${options.dryRun ? 'DRY RUN' : 'LIVE'}`);
  console.log(`Archive records older than: ${options.months} months`);
  console.log(`Workspace filter: ${options.workspaceId || 'ALL'}`);
  console.log('');

  // Calculate cutoff date
  const cutoffDate = new Date();
  cutoffDate.setMonth(cutoffDate.getMonth() - options.months);
  console.log(`Cutoff date: ${cutoffDate.toISOString()}`);

  // Find records to archive
  const whereClause = options.workspaceId
    ? 'WHERE created_at < $1 AND archived_at IS NULL AND workspace_id = $2'
    : 'WHERE created_at < $1 AND archived_at IS NULL';
  const params = options.workspaceId
    ? [cutoffDate.toISOString(), options.workspaceId]
    : [cutoffDate.toISOString()];

  const countResult = await pool.query(
    `SELECT COUNT(*) as count FROM audit_logs ${whereClause}`,
    params
  );
  const totalRecords = parseInt(countResult.rows[0].count);

  if (totalRecords === 0) {
    console.log('No records to archive');
    await pool.end();
    return;
  }

  console.log(`Found ${totalRecords} records to archive`);

  // Get records to archive (in order for hash chain continuity)
  const recordsResult = await pool.query(
    `SELECT * FROM audit_logs ${whereClause} ORDER BY created_at ASC, id ASC`,
    params
  );
  const records = recordsResult.rows as AuditRecord[];

  // Get the oldest and newest timestamps
  const oldestRecord = records[0];
  const newestRecord = records[records.length - 1];
  console.log(`Date range: ${oldestRecord.created_at} to ${newestRecord.created_at}`);

  // Verify CloudWatch has these records
  const recordIds = records.map(r => r.id);
  const cloudwatchOk = await verifyCloudWatchRecords(
    recordIds,
    oldestRecord.created_at,
    newestRecord.created_at
  );

  if (!cloudwatchOk) {
    console.error('ERROR: CloudWatch verification failed. Aborting archival.');
    await pool.end();
    process.exit(1);
  }

  // Archive to S3
  const { location, checksum } = await archiveToS3(records, options.workspaceId || null);

  if (options.dryRun) {
    console.log('');
    console.log('[DRY RUN] Would perform the following:');
    console.log(`  1. Upload ${records.length} records to S3`);
    console.log(`  2. Create archive_checkpoint with hash: ${newestRecord.record_hash}`);
    console.log(`  3. Log 'audit.records_archived' event`);
    console.log(`  4. Delete ${records.length} records from PostgreSQL`);
    await pool.end();
    return;
  }

  // Start transaction for delete operation
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Create archive checkpoint BEFORE deleting
    await client.query(
      `INSERT INTO archive_checkpoint (
        last_record_id, last_record_created_at, last_record_hash,
        records_archived, archive_location, archive_checksum, workspace_id
      ) VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [
        newestRecord.id,
        newestRecord.created_at,
        newestRecord.record_hash,
        records.length,
        location,
        checksum,
        options.workspaceId || null,
      ]
    );
    console.log('✓ Created archive checkpoint');

    // Log the archival event (BEFORE disabling triggers)
    await client.query(
      `INSERT INTO audit_logs (workspace_id, action, resource_type, details)
       VALUES ($1, 'audit.records_archived', 'audit_logs', $2)`,
      [
        options.workspaceId || null,
        JSON.stringify({
          records_archived: records.length,
          oldest_record: oldestRecord.created_at,
          newest_record: newestRecord.created_at,
          archive_location: location,
          cutoff_months: options.months,
        }),
      ]
    );
    console.log('✓ Logged archival event');

    // Delete the archived records
    await deleteArchivedRecords(client, recordIds);
    console.log(`✓ Deleted ${records.length} records from PostgreSQL`);

    await client.query('COMMIT');
    console.log('');
    console.log('='.repeat(60));
    console.log('ARCHIVAL COMPLETE');
    console.log('='.repeat(60));
    console.log(`Records archived: ${records.length}`);
    console.log(`Archive location: ${location}`);
    console.log(`Archive checksum: ${checksum}`);
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('ERROR: Archival failed, transaction rolled back:', error);
    throw error;
  } finally {
    client.release();
  }

  await pool.end();
}

// Run the script
main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
