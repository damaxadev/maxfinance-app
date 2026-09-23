import { Component } from '@angular/core';
import { RouterLink } from '@angular/router';

import { Card } from '../../../shared/card/card';

@Component({
  selector: 'mfx-settings',
  imports: [Card, RouterLink],
  templateUrl: './settings.html',
  styleUrl: './settings.scss',
})
export class Settings {}
