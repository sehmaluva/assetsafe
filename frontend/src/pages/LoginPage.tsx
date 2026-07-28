import { useState } from 'react';
import { useLocation, Navigate, Link } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@/lib/zodResolver';
import { z } from 'zod';
import { toast } from 'sonner';
import { Eye, EyeOff, Shield, Loader2, Lock, User } from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';
import { useAuthBootstrap } from '@/hooks/useAuthBootstrap';
import { useAuthStore } from '@/store';
import { cn } from '@/lib/utils';
import { canAccessAssetRegistry, resolveSafeRedirect } from '@/lib/registryNav';

const schema = z.object({
  username: z.string().min(1, 'Username is required'),
  password: z.string().min(1, 'Password is required'),
});

type FormValues = z.infer<typeof schema>;

export default function LoginPage() {
  const location = useLocation();
  const { login, isAuthenticated, isInitializing } = useAuth();
  useAuthBootstrap();
  const user = useAuthStore((s) => s.user);
  const authReady = useAuthStore((s) => s.authReady);
  const [showPassword, setShowPassword] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const fromPath =
    (location.state as { from?: { pathname?: string } } | null)?.from
      ?.pathname ?? '/dashboard';
  const redirectTo = resolveSafeRedirect(
    fromPath,
    canAccessAssetRegistry(user, authReady),
  );

  const {
    register,
    handleSubmit,
    setError,
    formState: { errors },
  } = useForm<FormValues>({
    resolver: zodResolver(schema),
  });

  // Already authenticated → skip login screen
  if (!isInitializing && isAuthenticated) {
    return <Navigate to={redirectTo} replace />;
  }

  const onSubmit = async (values: FormValues) => {
    setIsLoading(true);
    try {
      await login(
        { username: values.username, password: values.password },
        fromPath,
      );
      toast.success('Welcome back!');
    } catch (err: any) {
      const data = err?.response?.data;
      const nonField = data?.non_field_errors?.[0];
      const raw =
        (typeof data?.error === 'string' && data.error) ||
        (typeof data?.detail === 'string' && data.detail) ||
        (typeof data?.message === 'string' && data.message) ||
        (typeof nonField === 'string' && nonField) ||
        (nonField && typeof nonField === 'object' && String(nonField)) ||
        'Invalid username or password.';
      const lower = String(raw).toLowerCase();
      const msg =
        lower.includes('not verified')
          ? 'Account not verified. Please verify your account.'
          : lower.includes('no active account') ||
              lower.includes('given credentials') ||
              lower.includes('invalid credentials') ||
              lower.includes('authentication failed')
            ? 'Invalid username or password.'
            : String(raw);
      setError('root', { message: msg });
      toast.error(msg);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-white p-4">
      <div className="w-full max-w-sm space-y-6 rounded-xl border border-slate-200 bg-white p-6 shadow-md">
        <div className="flex items-center justify-center gap-2">
          <Shield className="h-8 w-8 text-[#0f7d8e]" />
          <span className="text-2xl font-black tracking-widest text-black uppercase">
            AssetSafe
          </span>
        </div>

        <div className="text-center space-y-2">
          <h2 className="text-3xl font-bold text-black">Sign In</h2>
          <p className="text-sm text-slate-600">
            Enter your credentials to access AssetSafe
          </p>
        </div>

        <form
          onSubmit={handleSubmit(onSubmit)}
          className="space-y-4 pt-2"
          noValidate
        >
          {errors.root && (
            <div className="rounded-lg border border-red-500/30 bg-red-50 px-4 py-3">
              <p className="text-sm text-red-700">{errors.root.message}</p>
            </div>
          )}

          <div className="space-y-1.5">
            <label className="text-sm font-semibold text-black">
              Username or Email
            </label>
            <div className="relative">
              <User className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
              <input
                {...register('username')}
                autoComplete="username"
                autoFocus
                placeholder="your.username or your.email@example.com"
                className={cn(
                  'w-full rounded-lg border py-2.5 pl-9 pr-3 text-sm text-black placeholder:text-slate-400',
                  'bg-white focus:outline-none focus:ring-2 transition-all',
                  errors.username
                    ? 'border-red-500/50 focus:ring-red-500/30'
                    : 'border-slate-300 focus:border-[#0f7d8e] focus:ring-[#0f7d8e]/20',
                )}
              />
            </div>
            {errors.username && (
              <p className="text-xs text-red-600">{errors.username.message}</p>
            )}
          </div>

          <div className="space-y-1.5">
            <label className="text-sm font-semibold text-black">Password</label>
            <div className="relative">
              <Lock className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
              <input
                {...register('password')}
                type={showPassword ? 'text' : 'password'}
                autoComplete="current-password"
                placeholder="Enter your password"
                className={cn(
                  'w-full rounded-lg border py-2.5 pl-9 pr-10 text-sm text-black placeholder:text-slate-400',
                  'bg-white focus:outline-none focus:ring-2 transition-all',
                  errors.password
                    ? 'border-red-500/50 focus:ring-red-500/30'
                    : 'border-slate-300 focus:border-[#0f7d8e] focus:ring-[#0f7d8e]/20',
                )}
              />
              <button
                type="button"
                onClick={() => setShowPassword((v) => !v)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 transition-colors"
              >
                {showPassword ? (
                  <EyeOff className="h-4 w-4" />
                ) : (
                  <Eye className="h-4 w-4" />
                )}
              </button>
            </div>
            {errors.password && (
              <p className="text-xs text-red-600">{errors.password.message}</p>
            )}
            <p className="pt-1 text-center">
              <Link
                to="/forgot-password"
                className="text-xs font-semibold text-[#0f7d8e] hover:text-[#0d6e7e] transition-colors"
              >
                Forgot password?
              </Link>
            </p>
          </div>

          <button
            type="submit"
            disabled={isLoading}
            className={cn(
              'flex w-full items-center justify-center gap-2 rounded-lg py-2.5 text-sm font-semibold',
              'bg-[#0f7d8e] text-white transition-all duration-150 mt-6',
              'hover:bg-[#0d6e7e] focus:outline-none focus:ring-2 focus:ring-[#0f7d8e]/50',
              'disabled:opacity-60 disabled:cursor-not-allowed',
            )}
          >
            {isLoading ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" /> Signing in...
              </>
            ) : (
              'Sign In'
            )}
          </button>
        </form>

        <p className="text-center text-xs text-slate-600">
          AssetSafe &copy; {new Date().getFullYear()}
        </p>
      </div>
    </div>
  );
}
