import { lookup } from 'node:dns/promises';

/** Every address `hostname` resolves to, via the OS resolver. */
export async function resolveAllAddresses(hostname: string): Promise<readonly string[]> {
  const records = await lookup(hostname, { all: true, verbatim: true });
  return records.map((record) => record.address);
}
