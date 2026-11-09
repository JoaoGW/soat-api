import { WorkloadIdentityCredential } from '@azure/identity';
import { ServiceBusClient } from '@azure/service-bus';
import {
  createServiceBusClient,
  serviceBusConfigured,
} from './ServiceBusConnection';

jest.mock('@azure/identity');
jest.mock('@azure/service-bus');

describe('ServiceBusConnection', () => {
  const originalEnv = process.env;
  const emulator =
    'Endpoint=sb://servicebus;SharedAccessKeyName=RootManageSharedAccessKey;SharedAccessKey=SAS_KEY_VALUE;UseDevelopmentEmulator=true;';
  beforeEach(() => {
    jest.clearAllMocks();
    process.env = { ...originalEnv };
    for (const name of [
      'ALLOW_LOCAL_EMULATORS',
      'SERVICE_BUS_CONNECTION_STRING',
      'AZURE_TENANT_ID',
      'AZURE_CLIENT_ID',
      'AZURE_FEDERATED_TOKEN_FILE',
    ])
      delete process.env[name];
  });
  afterEach(() => {
    process.env = originalEnv;
  });

  it('exige namespace Azure e identidade de workload por padrão', () => {
    process.env.SERVICE_BUS_CONNECTION_STRING = emulator;
    expect(serviceBusConfigured('soat.servicebus.windows.net')).toBe(false);
    Object.assign(process.env, {
      AZURE_TENANT_ID: 'tenant',
      AZURE_CLIENT_ID: 'client',
      AZURE_FEDERATED_TOKEN_FILE: '/tmp/token',
    });
    expect(serviceBusConfigured('soat.servicebus.windows.net')).toBe(true);
    expect(serviceBusConfigured('localhost')).toBe(false);
    createServiceBusClient('soat.servicebus.windows.net');
    expect(ServiceBusClient).toHaveBeenCalledWith(
      'soat.servicebus.windows.net',
      expect.any(WorkloadIdentityCredential),
    );
  });

  it('aceita somente o emulador quando a trava local está habilitada', () => {
    process.env.ALLOW_LOCAL_EMULATORS = 'true';
    process.env.SERVICE_BUS_CONNECTION_STRING =
      'Endpoint=sb://soat.servicebus.windows.net/;SharedAccessKeyName=x;SharedAccessKey=y';
    expect(serviceBusConfigured(undefined)).toBe(false);
    process.env.SERVICE_BUS_CONNECTION_STRING = emulator;
    expect(serviceBusConfigured(undefined)).toBe(true);
    createServiceBusClient(undefined);
    expect(ServiceBusClient).toHaveBeenCalledWith(emulator);
    expect(WorkloadIdentityCredential).not.toHaveBeenCalled();
  });
});
