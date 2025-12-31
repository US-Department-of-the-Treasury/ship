import { SSMClient, GetParameterCommand } from '@aws-sdk/client-ssm';

const client = new SSMClient({ region: process.env.AWS_REGION || 'us-east-1' });

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

  const ssmPath = process.env.SSM_PATH || '/ship/prod';

  console.log(`Loading secrets from SSM path: ${ssmPath}`);

  const [databaseUrl, sessionSecret] = await Promise.all([
    getSSMSecret(`${ssmPath}/database-url`),
    getSSMSecret(`${ssmPath}/session-secret`),
  ]);

  process.env.DATABASE_URL = databaseUrl;
  process.env.SESSION_SECRET = sessionSecret;

  console.log('Secrets loaded from SSM Parameter Store');
}
