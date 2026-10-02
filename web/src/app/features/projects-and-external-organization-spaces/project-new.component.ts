import { Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import {
  ORGANIZATION_TYPES,
  OrganizationType,
  ProjectsApiService,
} from './projects-api.service';
import { projectErrorMessage } from './project-errors';

@Component({
  selector: 'app-project-new',
  standalone: true,
  imports: [FormsModule, RouterLink],
  template: `
    <section class="project-new" data-testid="project-new-page">
      <a routerLink="/projects">← Back to projects</a>
      <h1>New Project</h1>

      <form (ngSubmit)="submit()" data-testid="project-new-form">
        <div class="field">
          <label for="organizationName">Organization name</label>
          <input
            id="organizationName"
            name="organizationName"
            [(ngModel)]="orgName"
            autocomplete="organization"
          />
        </div>

        <div class="field">
          <label for="organizationType">Type</label>
          <select id="organizationType" name="organizationType" [(ngModel)]="orgType">
            @for (t of types; track t) {
              <option [value]="t">{{ t }}</option>
            }
          </select>
        </div>

        @if (formError()) {
          <p class="error" role="alert" data-testid="form-error">{{ formError() }}</p>
        }

        <button type="submit" [disabled]="saving()">Create project</button>
      </form>
    </section>
  `,
  styles: [
    '.project-new { padding: 1.5rem; max-width: 40rem; display: flex; flex-direction: column; gap: 1rem; }',
    'form { display: flex; flex-direction: column; gap: 1rem; }',
    '.field { display: flex; flex-direction: column; gap: 0.25rem; }',
    'label { font-weight: 500; font-size: 0.875rem; }',
    'input, select { padding: 0.5rem; border: 1px solid #d1d5db; border-radius: 0.375rem; font-size: 1rem; }',
    '.error { color: #b91c1c; }',
    'button { padding: 0.5rem 1.25rem; background: #4f46e5; color: #fff; border: none; border-radius: 0.375rem; cursor: pointer; font-size: 1rem; align-self: flex-start; }',
    'button:disabled { opacity: 0.6; cursor: not-allowed; }',
  ],
})
export class ProjectNewComponent {
  private api = inject(ProjectsApiService);
  private router = inject(Router);

  readonly types = ORGANIZATION_TYPES;
  readonly saving = signal(false);
  readonly formError = signal<string | null>(null);

  orgName = '';
  orgType: OrganizationType = 'vendor';

  async submit(): Promise<void> {
    const name = this.orgName.trim();
    if (!name) {
      this.formError.set('Organization name is required');
      return;
    }
    this.saving.set(true);
    this.formError.set(null);
    try {
      const created = await this.api.create({ organization_name: name, organization_type: this.orgType });
      await this.router.navigate(['/projects', created.id]);
    } catch (err) {
      this.formError.set(projectErrorMessage(err, 'Could not create project.'));
    } finally {
      this.saving.set(false);
    }
  }
}
