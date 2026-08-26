import { provideBrowserGlobalErrorListeners, provideZonelessChangeDetection } from '@angular/core';
import type { ApplicationConfig } from '@angular/core';
import { provideHttpClient, withFetch, withInterceptors } from '@angular/common/http';
import { provideFileRouter, requestContextInterceptor } from '@analogjs/router';
import { provideMovement } from 'angular-movement';
import { provideVoltTheme } from '@voltui/components';

export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    provideZonelessChangeDetection(),
    provideFileRouter(),
    provideHttpClient(withFetch(), withInterceptors([requestContextInterceptor])),
    provideVoltTheme({ color: 'sage', style: 'sharp', dark: false }),
    provideMovement({
      duration: 260,
      easing: 'cubic-bezier(0.16, 1, 0.3, 1)',
    }),
  ],
};
