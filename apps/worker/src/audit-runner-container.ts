import { Container } from '@cloudflare/containers';

export class AuditRunnerContainer extends Container {
  override defaultPort = 8080;
  override sleepAfter = '2m';
  override enableInternet = true;
  override pingEndpoint = '/healthz';
}
