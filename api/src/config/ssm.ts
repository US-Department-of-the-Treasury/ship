import { SSMClient, GetParameterCommand } from '@aws-sdk/client-ssm';

const client = new SSMClient({ region: process.env.AWS_REGION || 'us-east-1' });

/**
 * Get an SSM parameter, returning null if not found (for optional parameters)
 */
async function getOptionalSSMSecret(name: string): Promise<string | null> {
  try {
    const command = new GetParameterCommand({
      Name: name,
      WithDecryption: true,
    });
    const response = await client.send(command);
    return response.Parameter?.Value || null;
  } catch (error: unknown) {
    // Parameter not found is expected for optional secrets
    if (error && typeof error === 'object' && 'name' in error && error.name === 'ParameterNotFound') {
      return null;
    }
    throw error;
  }
}

export async function getSSMSecret(name: string): Promise<string> {
  const command = new GetParameterCommand({
    Name: name,
    WithDecryption: true,
  });

  const response = await client.send(command);
  if (!response.Parameter?.Value) {
    throw new Error(`SSM parameter ${name} not found`);
  }
  return response.Parameter.Value;
}

export async function loadProductionSecrets(): Promise<void> {
  if (process.env.NODE_ENV !== 'production') {
    return; // Use .env files for local dev
  }

  const environment = process.env.ENVIRONMENT || 'prod';
  const basePath = `/ship/${environment}`;

  console.log(`Loading secrets from SSM path: ${basePath}`);

  const [databaseUrl, sessionSecret, corsOrigin] = await Promise.all([
    getSSMSecret(`${basePath}/DATABASE_URL`),
    getSSMSecret(`${basePath}/SESSION_SECRET`),
    getSSMSecret(`${basePath}/CORS_ORIGIN`),
  ]);

  process.env.DATABASE_URL = databaseUrl;
  process.env.SESSION_SECRET = sessionSecret;
  process.env.CORS_ORIGIN = corsOrigin;

  console.log('Secrets loaded from SSM Parameter Store');
  console.log(`CORS_ORIGIN: ${corsOrigin}`);

  // Optional FPKI/PIV authentication variables
  await loadOptionalFPKISecrets(basePath);
}

/**
 * Load optional FPKI/PIV authentication secrets from SSM.
 * These are only needed if PIV authentication is enabled.
 */
async function loadOptionalFPKISecrets(basePath: string): Promise<void> {
  const fpkiParams = [
    'FPKI_ISSUER_URL',
    'FPKI_CLIENT_ID',
    'FPKI_REDIRECT_URI',
    'FPKI_CLIENT_SECRET',     // For client_secret_post auth
    'FPKI_PRIVATE_KEY_PEM',   // For private_key_jwt auth
  ];

  const results = await Promise.all(
    fpkiParams.map(param => getOptionalSSMSecret(`${basePath}/${param}`))
  );

  fpkiParams.forEach((param, index) => {
    if (results[index]) {
      process.env[param] = results[index] as string;
    }
  });

  // Log whether PIV auth is configured (without exposing secrets)
  const hasIssuer = !!process.env.FPKI_ISSUER_URL;
  const hasClientId = !!process.env.FPKI_CLIENT_ID;
  const hasRedirect = !!process.env.FPKI_REDIRECT_URI;
  const hasAuth = !!process.env.FPKI_CLIENT_SECRET || !!process.env.FPKI_PRIVATE_KEY_PEM;

  if (hasIssuer && hasClientId && hasRedirect && hasAuth) {
    console.log('FPKI/PIV authentication: ENABLED');
  } else if (hasIssuer || hasClientId || hasRedirect) {
    console.log('FPKI/PIV authentication: PARTIALLY CONFIGURED (check SSM parameters)');
  } else {
    console.log('FPKI/PIV authentication: DISABLED (no SSM parameters found)');
  }
}
