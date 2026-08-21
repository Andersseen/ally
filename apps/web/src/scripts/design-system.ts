import {
  ACCESSIBILITY,
  ACTIVITY,
  ALERT_CIRCLE,
  ARROW_RIGHT,
  CHECK,
  EXTERNAL_LINK,
  FILE_TEXT,
  INFO,
  LOADER,
  PLAY,
  SUCCESS,
  MOON,
  SUN,
  WARNING,
  registerIcons,
} from '@andersseen/icon';
import { initMotion } from '@andersseen/motion';
import { defineAllCustomElements } from '@andersseen/web-components';

registerIcons({
  accessibility: ACCESSIBILITY,
  activity: ACTIVITY,
  'alert-circle': ALERT_CIRCLE,
  'arrow-right': ARROW_RIGHT,
  check: CHECK,
  'external-link': EXTERNAL_LINK,
  'file-text': FILE_TEXT,
  info: INFO,
  loader: LOADER,
  moon: MOON,
  play: PLAY,
  success: SUCCESS,
  sun: SUN,
  warning: WARNING,
});

defineAllCustomElements();
initMotion({ rootMargin: '0px 0px -8% 0px' });
