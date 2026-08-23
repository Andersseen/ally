import { Container } from '@cloudflare/containers';

export class AuditRunnerContainer extends Container {
  override defaultPort = 8080;
  override sleepAfter = '30s';
  override enableInternet = true;
  override pingEndpoint = '/healthz';
}
