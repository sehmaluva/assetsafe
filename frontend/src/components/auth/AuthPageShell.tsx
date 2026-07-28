import { Link } from 'react-router-dom';
import { Shield } from 'lucide-react';

interface AuthPageShellProps {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
  footer?: React.ReactNode;
}

export function AuthPageShell({
  title,
  subtitle,
  children,
  footer,
}: AuthPageShellProps) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-white p-4">
      <div className="w-full max-w-sm space-y-6 rounded-xl border border-slate-200 bg-white p-6 shadow-md">
        <div className="flex items-center justify-center gap-2">
          <Shield className="h-8 w-8 text-[#0f7d8e]" />
          <Link
            to="/login"
            className="text-2xl font-black tracking-widest text-black uppercase"
          >
            AssetSafe
          </Link>
        </div>

        <div className="space-y-2 text-center">
          <h2 className="text-2xl font-bold text-black">{title}</h2>
          {subtitle ? (
            <p className="text-sm text-slate-600">{subtitle}</p>
          ) : null}
        </div>

        {children}

        {footer ?? (
          <p className="text-center text-xs text-slate-600">
            AssetSafe &copy; {new Date().getFullYear()}
          </p>
        )}
      </div>
    </div>
  );
}
