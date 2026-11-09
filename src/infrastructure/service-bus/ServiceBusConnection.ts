import { WorkloadIdentityCredential } from '@azure/identity';
import { ServiceBusClient } from '@azure/service-bus';

// Em produção o acesso é exclusivo por identidade de workload. O emulador só é
// aceito com ALLOW_LOCAL_EMULATORS=true, no ambiente kind local e no CI.
function emulatorConnection(): string | undefined {
  if (process.env.ALLOW_LOCAL_EMULATORS !== 'true') return undefined;
  const connection = process.env.SERVICE_BUS_CONNECTION_STRING;
  return connection &&
    /(^|;)\s*UseDevelopmentEmulator=true\s*(;|$)/i.test(connection)
    ? connection
    : undefined;
}

export function serviceBusConfigured(namespace: string | undefined): boolean {
  return (
    !!emulatorConnection() ||
    (!!namespace &&
      /^[a-z0-9-]+\.servicebus\.windows\.net$/i.test(namespace) &&
      !!process.env.AZURE_TENANT_ID &&
      !!process.env.AZURE_CLIENT_ID &&
      !!process.env.AZURE_FEDERATED_TOKEN_FILE)
  );
}

export function createServiceBusClient(
  namespace: string | undefined,
): ServiceBusClient {
  const connection = emulatorConnection();
  return connection
    ? new ServiceBusClient(connection)
    : new ServiceBusClient(
        namespace as string,
        new WorkloadIdentityCredential(),
      );
}
