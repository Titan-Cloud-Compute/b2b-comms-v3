import { Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';

/**
 * Public invitation acceptance page (/accept-invite/:token).
 * Posts the token plus the invitee's chosen name and password to
 * POST /api/invitations/accept, then sends them to /login.
 */
@Component({
  selector: 'app-accept-invite',
  standalone: true,
  imports: [FormsModule, RouterLink],
  template: `
    <main class="accept-invite">
      <h1>Accept invitation</h1>
      @if (done()) {
        <p role="status">Your account is ready. You can now sign in.</p>
        <a routerLink="/login">Go to sign in</a>
      } @else {
        <form (ngSubmit)="submit()" aria-label="Accept invitation">
          <label>
            Display name
            <input name="displayName" [(ngModel)]="displayName" required autocomplete="name" />
          </label>
          <label>
            Password
            <input name="password" type="password" [(ngModel)]="password" required minlength="8" autocomplete="new-password" />
          </label>
          @if (error()) {
            <p role="alert">{{ error() }}</p>
          }
          <button type="submit" [disabled]="busy()">Accept invitation</button>
        </form>
      }
    </main>
  `,
  styles: [
    '.accept-invite { max-width: 420px; margin: 48px auto; padding: 0 16px; display: flex; flex-direction: column; gap: 12px; }',
    'form { display: flex; flex-direction: column; gap: 12px; }',
    'label { display: flex; flex-direction: column; gap: 4px; }',
  ],
})
export class AcceptInviteComponent {
  private route = inject(ActivatedRoute);
  private router = inject(Router);

  displayName = '';
  password = '';
  busy = signal(false);
  error = signal('');
  done = signal(false);

  async submit(): Promise<void> {
    const token = this.route.snapshot.paramMap.get('token') ?? '';
    if (!token) {
      this.error.set('This invitation link is invalid.');
      return;
    }
    if (!this.displayName.trim() || this.password.length < 8) {
      this.error.set('Enter your name and a password of at least 8 characters.');
      return;
    }
    this.busy.set(true);
    this.error.set('');
    let url = 'api/invitations/accept';
    try {
      url = new URL('api/invitations/accept', document.baseURI).toString();
    } catch {
      /* keep relative */
    }
    try {
      const res = await fetch(url, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, displayName: this.displayName.trim(), password: this.password }),
      });
      if (res.ok) {
        this.done.set(true);
        void this.router.navigate(['/login']);
      } else {
        this.error.set(res.status === 404 || res.status === 410
          ? 'This invitation has expired or was already used.'
          : 'Could not accept the invitation. Please try again.');
      }
    } catch {
      this.error.set('Could not reach the server. Please try again.');
    } finally {
      this.busy.set(false);
    }
  }
}
