import './styles/styles.css';
import { bootstrapApplication } from '@angular/platform-browser';
import { AppComponent } from './app/app.component';
import { appConfig } from './app/app.config';

function initUmami(): void {
  const url = import.meta.env.PUBLIC_UMAMI_URL;
  const websiteId = import.meta.env.PUBLIC_UMAMI_WEBSITE_ID;
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
