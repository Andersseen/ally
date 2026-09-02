import './styles/styles.css';
import { bootstrapApplication } from '@angular/platform-browser';
import { AppComponent } from './app/app.component';
import { appConfig } from './app/app.config';

function initUmami(): void {
  const publicEnv = import.meta.env as Readonly<Record<string, string | undefined>>;
  const url = publicEnv['PUBLIC_UMAMI_URL'];
  const websiteId = publicEnv['PUBLIC_UMAMI_WEBSITE_ID'];
  if (!url || !websiteId) return;
  const script = document.createElement('script');
  script.defer = true;
  script.src = url;
  script.dataset.websiteId = websiteId;
  document.head.appendChild(script);
}

initUmami();

bootstrapApplication(AppComponent, appConfig).catch((error: unknown) => {
  console.error(error);
});
