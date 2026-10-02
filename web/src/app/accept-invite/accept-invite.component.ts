import { Component, signal, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterLink, ActivatedRoute, Router } from '@angular/router';
import { AuthApi } from '../shared/api/auth-api.service';
import { AuthService } from '../shared/auth.service';

/** Public page reached from an invitation email: /accept-invite/:token. */
@Component({
  selector: 'app-accept-invite',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterLink],
  template: `
    <div class="invite-page">
      <div class="invite-container">
        <h1 class="form-title">Accept invitation</h1>
        <p class="form-subtitle">Choose a display name and password to join.</p>
        <form (ngSubmit)="onSubmit()" class="invite-form" data-testid="accept-invite-form">
          @if (error()) {
            <div class="error-message" role="alert">{{ error() }}</div>
          }
          <div class="form-group">
            <label for="displayName">Display name</label>
            <input id="displayName" name="displayName" type="text" [(ngModel)]="displayName" required autocomplete="name" />
          </div>
          <div class="form-group">
            <label for="password">Password</label>
            <input id="password" name="password" type="password" [(ngModel)]="password" required minlength="8" autocomplete="new-password" />
          </div>
          <button type="submit" class="btn-primary" [disabled]="isLoading()">
            @if (isLoading()) { Joining… } @else { Accept invitation }
          </button>
        </form>
        <p class="back-link"><a routerLink="/login">Back to Sign In</a></p>
      </div>
    </div>
  `,
  styles: [`
    .invite-page { min-height: 100vh; display: flex; align-items: center; justify-content: center; }
    .invite-container { width: 100%; max-width: 440px; padding: 1rem; }
    .invite-form { display: flex; flex-direction: column; gap: 1rem; }
    .form-group { display: flex; flex-direction: column; gap: 0.25rem; }
    .error-message { color: #b91c1c; }
  `],
})
export class AcceptInviteComponent {
  private route = inject(ActivatedRoute);
  private router = inject(Router);
  private authApi = inject(AuthApi);
  private auth = inject(AuthService);

  displayName = '';
  password = '';
  isLoading = signal(false);
  error = signal<string | null>(null);

  async onSubmit(): Promise<void> {
    const token = this.route.snapshot.paramMap.get('token') ?? '';
    if (!this.displayName.trim() || this.password.length < 8) {
      this.error.set('Enter a display name and a password of at least 8 characters.');
      return;
    }
    this.isLoading.set(true);
    this.error.set(null);
    try {
      const user = await this.authApi.acceptInvitation({
        token,
        password: this.password,
        displayName: this.displayName.trim(),
      });
      this.auth.setUser({
        id: user.id,
        email: user.email,
        name: this.displayName.trim(),
        role: user.role === 'MANAGER' || user.role === 'ADMIN' || user.role === 'SUPER_ADMIN' ? user.role : 'USER',
      });
      this.router.navigate(['/projects']);
    } catch {
      this.error.set('This invitation is invalid or has expired.');
    } finally {
      this.isLoading.set(false);
    }
  }
}
