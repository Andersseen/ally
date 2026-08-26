import { Component, inject } from '@angular/core';
import { LmnMoonIcon } from 'lumen-icons/moon';
import { LmnSunIcon } from 'lumen-icons/sun';
import { ThemeService } from '../../core/theme/theme.service';

@Component({
  selector: 'ally-theme-toggle',
  imports: [LmnMoonIcon, LmnSunIcon],
  template: `
    <button
      class="theme-toggle"
      type="button"
      [attr.aria-label]="theme.mode() === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'"
      title="Switch theme"
      (click)="theme.toggle()"
    >
      @if (theme.mode() === 'dark') {
        <lmn-moon [size]="16" />
      } @else {
        <lmn-sun [size]="16" />
      }
    </button>
  `,
})
export class ThemeToggleComponent {
  readonly theme = inject(ThemeService);
}
