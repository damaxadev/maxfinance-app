import { bootstrapApplication } from '@angular/platform-browser';
import { register as registerSwiperElements } from 'swiper/element';
import { appConfig } from './app/app.config';
import { App } from './app/app';

registerSwiperElements();

bootstrapApplication(App, appConfig)
  .catch((err) => console.error(err));
