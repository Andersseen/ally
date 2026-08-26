import { Component, inject, input } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import type { ValidatorFn } from '@angular/forms';
import { VoltButton, VoltCard, VoltCheckbox } from '@voltui/components';
import { LmnArrowRightIcon } from 'lumen-icons/arrow-right';
import { LmnPlayIcon } from 'lumen-icons/play';
import type { AuditOptions } from '../../core/api/ally-api.types';
import { AuditStore } from './audit-store.service';

const urlValidator = Validators.pattern(/^https?:\/\/\S+\.\S+/i);
const requiredValidator: ValidatorFn = (control) => Validators.required(control);

@Component({
  selector: 'ally-audit-form',
  imports: [
    ReactiveFormsModule,
    VoltButton,
    VoltCard,
    VoltCheckbox,
    LmnArrowRightIcon,
    LmnPlayIcon,
  ],
  template: `
    <form class="surface relative overflow-hidden p-5" [formGroup]="form" (ngSubmit)="submit()">
      <volt-card>
        <div class="flex flex-col gap-4 p-5">
          <div class="flex items-center justify-between gap-3">
            <div>
              <p class="eyebrow">Target</p>
              <h2 class="text-ally-ink mt-1 text-xl font-bold">Public URL</h2>
            </div>
            <span class="brand-icon" aria-hidden="true">
              <lmn-play [size]="16" />
            </span>
          </div>

          <label class="text-ally-ink text-sm font-semibold" for="audit-url">Public URL</label>
          <p id="audit-lock-message" class="text-ally-muted text-sm">
            {{
              authenticated()
                ? 'Your session is active. This audit will be billed to the protected Cloudflare project.'
                : 'Sign in to unlock hosted audits.'
            }}
          </p>
          <input
            id="audit-url"
            class="native-field"
            formControlName="url"
            type="url"
            inputmode="url"
            autocomplete="url"
            required
            placeholder="https://example.com"
            aria-describedby="audit-url-error audit-lock-message"
          />
          @if (form.controls.url.touched && form.controls.url.invalid) {
            <p id="audit-url-error" class="text-sm font-semibold text-[var(--ally-danger)]">
              Enter a valid public URL beginning with http:// or https://.
            </p>
          }

          <fieldset class="space-y-2">
            <legend class="text-ally-ink text-sm font-semibold">Audit options</legend>
            <label class="flex items-center gap-2 text-sm">
              <volt-checkbox formControlName="keyboard" />
              <span>Keyboard analysis</span>
            </label>
            <label class="flex items-center gap-2 text-sm">
              <volt-checkbox formControlName="recommendations" />
              <span>Recommendations</span>
            </label>
            <label class="flex items-center gap-2 text-sm">
              <volt-checkbox formControlName="markupValidation" />
              <span>Markup validation</span>
            </label>
            <label class="flex items-center gap-2 text-sm">
              <volt-checkbox formControlName="aiReview" />
              <span>AI-assisted WCAG review</span>
            </label>
          </fieldset>

          <volt-button
            class="w-full"
            type="submit"
            size="lg"
            [disabled]="!authenticated() || store.submitting()"
          >
            <lmn-arrow-right slot="leading" [size]="16" />
            {{ store.submitting() ? 'Running audit' : 'Run audit' }}
          </volt-button>
        </div>
      </volt-card>
    </form>
  `,
})
export class AuditFormComponent {
  private readonly fb = inject(FormBuilder);
  readonly store = inject(AuditStore);
  readonly authenticated = input(false);
  readonly form = this.fb.nonNullable.group({
    url: ['', [requiredValidator, urlValidator]],
    keyboard: [true],
    recommendations: [false],
    markupValidation: [false],
    aiReview: [false],
  });

  async submit(): Promise<void> {
    if (this.form.invalid || !this.authenticated()) {
      this.form.markAllAsTouched();
      return;
    }
    const value = this.form.getRawValue();
    const options: AuditOptions = {
      keyboard: value.keyboard,
      recommendations: value.recommendations,
      markupValidation: value.markupValidation,
      aiReview: value.aiReview,
    };
    await this.store.startAudit(value.url, options);
  }
}
