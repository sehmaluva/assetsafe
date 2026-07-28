import { useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { useSearchParams } from 'react-router-dom';
import { z } from 'zod';
import { zodResolver } from '@/lib/zodResolver';
import { toast } from 'sonner';
import { Loader2 } from 'lucide-react';
import { authApi } from '@/api/authApi';
import { useAuthStore } from '@/store';
import { normalizeAuthUser } from '@/api/authApi';
import { cn } from '@/lib/utils';
import { applyApiValidationErrors } from '@/lib/formErrors';

const profileSchema = z.object({
  first_name: z.string().max(150),
  last_name: z.string().max(150),
  position: z.string().max(100).optional(),
});

const passwordSchema = z
  .object({
    current_password: z.string().min(1, 'Current password is required'),
    new_password: z.string().min(8, 'At least 8 characters'),
    confirm_password: z.string().min(1, 'Confirm your new password'),
  })
  .refine((d) => d.new_password === d.confirm_password, {
    message: 'Passwords must match',
    path: ['confirm_password'],
  });

type ProfileForm = z.infer<typeof profileSchema>;
type PasswordForm = z.infer<typeof passwordSchema>;
type SettingsTab = 'profile' | 'security';

function tabFromSearch(raw: string | null): SettingsTab {
  return raw === 'security' ? 'security' : 'profile';
}

export default function AccountSettingsPage() {
  const queryClient = useQueryClient();
  const setUser = useAuthStore((s) => s.setUser);
  const [searchParams, setSearchParams] = useSearchParams();
  const [tab, setTab] = useState<SettingsTab>(() =>
    tabFromSearch(searchParams.get('tab')),
  );

  useEffect(() => {
    setTab(tabFromSearch(searchParams.get('tab')));
  }, [searchParams]);

  const selectTab = (next: SettingsTab) => {
    setTab(next);
    if (next === 'security') {
      setSearchParams({ tab: 'security' });
    } else {
      setSearchParams({});
    }
  };

  const { data: profile, isLoading } = useQuery({
    queryKey: ['user-profile'],
    queryFn: () => authApi.getProfile(),
  });

  const profileForm = useForm<ProfileForm>({
    resolver: zodResolver(profileSchema),
    defaultValues: { first_name: '', last_name: '', position: '' },
  });

  const passwordForm = useForm<PasswordForm>({
    resolver: zodResolver(passwordSchema),
  });

  useEffect(() => {
    if (profile) {
      profileForm.reset({
        first_name: profile.first_name ?? '',
        last_name: profile.last_name ?? '',
        position: profile.position ?? '',
      });
    }
  }, [profile, profileForm]);

  const [savingProfile, setSavingProfile] = useState(false);
  const [savingPassword, setSavingPassword] = useState(false);

  const onProfileSubmit = async (values: ProfileForm) => {
    setSavingProfile(true);
    try {
      const updated = await authApi.updateProfile({
        first_name: values.first_name,
        last_name: values.last_name,
        position: values.position?.trim() ?? '',
      });
      setUser(normalizeAuthUser(updated as unknown as Record<string, unknown>));
      queryClient.invalidateQueries({ queryKey: ['user-profile'] });
      toast.success('Profile updated');
    } catch (err: unknown) {
      applyApiValidationErrors(profileForm.setError, err);
      toast.error('Could not update profile');
    } finally {
      setSavingProfile(false);
    }
  };

  const onPasswordSubmit = async (values: PasswordForm) => {
    setSavingPassword(true);
    try {
      await authApi.changePassword(values);
      passwordForm.reset();
      toast.success('Password changed');
    } catch (err: unknown) {
      applyApiValidationErrors(passwordForm.setError, err);
      toast.error('Could not change password');
    } finally {
      setSavingPassword(false);
    }
  };

  if (isLoading) {
    return (
      <div className="flex flex-1 items-center justify-center py-16">
        <Loader2 className="h-8 w-8 animate-spin text-[#0f7d8e]" />
      </div>
    );
  }

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-6 py-2">
      <div>
        <h1 className="text-xl font-bold text-slate-900">Account settings</h1>
        <p className="mt-1 text-sm text-slate-600">
          Update your profile and password.
        </p>
      </div>

      <div className="flex gap-2 border-b border-slate-200">
        {(['profile', 'security'] as const).map((key) => (
          <button
            key={key}
            type="button"
            onClick={() => selectTab(key)}
            className={cn(
              'border-b-2 px-4 py-2 text-sm font-semibold capitalize',
              tab === key
                ? 'border-[#0f7d8e] text-[#0f7d8e]'
                : 'border-transparent text-slate-500 hover:text-slate-800',
            )}
          >
            {key}
          </button>
        ))}
      </div>

      {tab === 'profile' ? (
        <form
          onSubmit={profileForm.handleSubmit(onProfileSubmit)}
          className="space-y-4 rounded border border-[#8f8f8f] bg-white p-6"
        >
          <p className="text-sm text-slate-500">
            Username:{' '}
            <span className="font-medium text-slate-800">
              {profile?.username}
            </span>
          </p>
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label className="text-sm font-semibold">First name</label>
              <input
                {...profileForm.register('first_name')}
                className="mt-1 w-full rounded border border-slate-300 px-3 py-2 text-sm"
              />
            </div>
            <div>
              <label className="text-sm font-semibold">Last name</label>
              <input
                {...profileForm.register('last_name')}
                className="mt-1 w-full rounded border border-slate-300 px-3 py-2 text-sm"
              />
            </div>
          </div>
          <div>
            <label className="text-sm font-semibold">Email</label>
            <input
              type="email"
              value={profile?.email ?? ''}
              disabled
              className="mt-1 w-full cursor-not-allowed rounded border border-slate-200 bg-slate-100 px-3 py-2 text-sm text-slate-500"
            />
            <p className="mt-1 text-xs text-slate-500">
              Email changes are disabled until email verification is available.
            </p>
          </div>
          <div>
            <label className="text-sm font-semibold">Position</label>
            <input
              {...profileForm.register('position')}
              placeholder="e.g. Asset Manager"
              className="mt-1 w-full rounded border border-slate-300 px-3 py-2 text-sm"
            />
            {profileForm.formState.errors.position ? (
              <p className="mt-1 text-xs text-red-600">
                {profileForm.formState.errors.position.message}
              </p>
            ) : null}
          </div>
          <button
            type="submit"
            disabled={savingProfile}
            className="rounded bg-[#0f7d8e] px-4 py-2 text-sm font-semibold text-white hover:bg-[#0d6e7e] disabled:opacity-60"
          >
            {savingProfile ? 'Saving…' : 'Save profile'}
          </button>
        </form>
      ) : (
        <form
          onSubmit={passwordForm.handleSubmit(onPasswordSubmit)}
          className="space-y-4 rounded border border-[#8f8f8f] bg-white p-6"
        >
          {(
            ['current_password', 'new_password', 'confirm_password'] as const
          ).map((field) => (
            <div key={field}>
              <label className="text-sm font-semibold capitalize">
                {field.replace(/_/g, ' ')}
              </label>
              <input
                {...passwordForm.register(field)}
                type="password"
                autoComplete={
                  field === 'current_password'
                    ? 'current-password'
                    : 'new-password'
                }
                className="mt-1 w-full rounded border border-slate-300 px-3 py-2 text-sm"
              />
              {passwordForm.formState.errors[field] ? (
                <p className="mt-1 text-xs text-red-600">
                  {passwordForm.formState.errors[field]?.message}
                </p>
              ) : null}
            </div>
          ))}
          <button
            type="submit"
            disabled={savingPassword}
            className="rounded bg-[#0f7d8e] px-4 py-2 text-sm font-semibold text-white hover:bg-[#0d6e7e] disabled:opacity-60"
          >
            {savingPassword ? 'Updating…' : 'Change password'}
          </button>
        </form>
      )}
    </div>
  );
}
