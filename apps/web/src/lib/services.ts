import {
  createBrowserClient,
  createSupabaseCatalogRepository,
  createSupabaseOrgRepository,
  DataError,
  toDataError,
  type CatalogRepository,
  type OrgRepository,
} from '@erp/data';

export interface AuthUser {
  id: string;
  email: string | null;
}

export interface AuthService {
  getUser(): Promise<AuthUser | null>;
  onChange(listener: (user: AuthUser | null) => void): () => void;
  signIn(email: string, password: string): Promise<void>;
  /** Returns true when the project requires e-mail confirmation before sign-in. */
  signUp(email: string, password: string, fullName: string): Promise<{ needsConfirmation: boolean }>;
  signOut(): Promise<void>;
}

/** Everything the UI talks to. Tests inject fakes; production wires Supabase. */
export interface Services {
  auth: AuthService;
  catalog: CatalogRepository;
  org: OrgRepository;
}

export function createSupabaseServices(config: { url: string; anonKey: string }, deviceId: string): Services {
  const client = createBrowserClient(config, deviceId);
  const toUser = (u: { id: string; email?: string | null } | null | undefined): AuthUser | null =>
    u ? { id: u.id, email: u.email ?? null } : null;

  const auth: AuthService = {
    async getUser() {
      const { data, error } = await client.auth.getSession();
      if (error) throw new DataError('auth.session_expired', error.message, null, error);
      return toUser(data.session?.user);
    },
    onChange(listener) {
      const { data } = client.auth.onAuthStateChange((_event, session) => listener(toUser(session?.user)));
      return () => data.subscription.unsubscribe();
    },
    async signIn(email, password) {
      const { error } = await client.auth.signInWithPassword({ email, password });
      if (error) throw new DataError('auth.failed', error.message, null, error);
    },
    async signUp(email, password, fullName) {
      const { data, error } = await client.auth.signUp({ email, password, options: { data: { full_name: fullName } } });
      if (error) throw new DataError('auth.failed', error.message, null, error);
      return { needsConfirmation: !data.session };
    },
    async signOut() {
      const { error } = await client.auth.signOut();
      if (error) throw toDataError(error);
    },
  };

  return {
    auth,
    catalog: createSupabaseCatalogRepository(client),
    org: createSupabaseOrgRepository(client),
  };
}
