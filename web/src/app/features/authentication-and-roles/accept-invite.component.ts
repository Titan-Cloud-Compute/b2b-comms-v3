import { Component, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { ApiClient } from '../../shared/api/api-client.service';
import { ApiError } from '../../shared/api/api-errors';

/**
 * Public invitation-accept page (/accept-invite/:token). The invited contact
 * picks a display name and password; the server answers 400 with a message
 * for expired or already-accepted tokens, which is shown verbatim.
 */
@Component({
  selector: 'app-accept-invite',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterLink],
  template: `
    <div class="login-page">
      <div class="form-container">
        <h2 class="form-title">Accept invitation</h2>
        <form data-testid="accept-invite-form" (ngSubmit)="onSubmit()">
          @if (error()) {
            <div class="error-message" role="alert" data-testid="accept-invite-error">{{ error() }}</div>
          }
          <label for="display_name">Display name</label>
          <input id="display_name" name="display_name" type="text" [(ngModel)]="displayName" required />
          <label for="password">Password</label>
          <input id="password" name="password" type="password" [(ngModel)]="password" required />
          <button type="submit" [disabled]="isLoading()">Accept invitation</button>
        </form>
        <a routerLink="/login">Back to sign in</a>
      </div>
    </div>
  `,
})
export class AcceptInviteComponent {
  private api = inject(ApiClient);
  private route = inject(ActivatedRoute);
  private router = inject(Router);

  displayName = '';
  password = '';
  error = signal<string | null>(null);
  isLoading = signal(false);

  async onSubmit(): Promise<void> {
    this.error.set(null);
    if (!this.displayName.trim() || !this.password) {
      this.error.set('Display name and password are required');
      return;
    }
    this.isLoading.set(true);
    try {
      await this.api.post('invitations/accept', {
        token: this.route.snapshot.paramMap.get('token') ?? '',
        display_name: this.displayName.trim(),
        password: this.password,
      });
      this.router.navigateByUrl('/login');
    } catch (err) {
      this.error.set(acceptErrorMessage(err));
    } finally {
      this.isLoading.set(false);
    }
  }
}

function acceptErrorMessage(err: unknown): string {
  if (err instanceof ApiError) {
    const raw: unknown = (err.body as { message?: unknown } | undefined)?.message;
    const msg = Array.isArray(raw) ? raw.join(', ') : raw;
    if (typeof msg === 'string' && msg) return msg;
    if (err.message) return err.message;
  }
  return 'Something went wrong. Please try again.';
}
