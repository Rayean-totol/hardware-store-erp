import {
  createBrowserClient,
  createSupabaseCatalogRepository,
  createSupabaseInventoryRepository,
  createSupabaseOrgRepository,
  createSupabaseSalesRepository,
  createSupabasePurchaseOrderRepository,
  createSupabaseSupplierRepository,
  DataError,
  toDataError,
  type CatalogRepository,
  type InventoryRepository,
  type OrgRepository,
  type SalesRepository,
  type PurchaseOrderRepository,
  type SupplierRepository,
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
  inventory: InventoryRepository;
  sales: SalesRepository;
  suppliers: SupplierRepository;
  purchaseOrders: PurchaseOrderRepository;
  productImages: ProductImageStore;
}

export interface ProductImageStore {
  /** Uploads to bucket "product-images" as <org>/<product>/<timestamp>.<ext>; returns the object path. */
  upload(orgId: string, productId: string, file: File, extension: string): Promise<string>;
  /** Short-lived signed URL for a private object. */
  signedUrl(path: string): Promise<string>;
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
      if (error) {
        // Offline or server trouble: still remove the session from this device.
        const local = await client.auth.signOut({ scope: 'local' });
        if (local.error) throw toDataError(local.error);
      }
    },
  };

  const catalog = createSupabaseCatalogRepository(client);
  const inventory = createSupabaseInventoryRepository(client);
  const bucket = client.storage.from('product-images');
  const productImages: ProductImageStore = {
    async upload(orgId, productId, file, extension) {
      const path = `${orgId}/${productId}/${Date.now()}.${extension}`;
      const { error } = await bucket.upload(path, file, { contentType: file.type, upsert: false });
      if (error) throw new DataError('storage.upload_failed', error.message, null, error);
      return path;
    },
    async signedUrl(path) {
      const { data, error } = await bucket.createSignedUrl(path, 60 * 60);
      if (error || !data) throw new DataError('storage.url_failed', error?.message ?? 'no URL returned', null, error);
      return data.signedUrl;
    },
  };
  return {
    auth,
    catalog,
    org: createSupabaseOrgRepository(client),
    inventory,
    sales: createSupabaseSalesRepository(client),
    suppliers: createSupabaseSupplierRepository(client),
    purchaseOrders: createSupabasePurchaseOrderRepository(client),
    productImages,
  };
}
