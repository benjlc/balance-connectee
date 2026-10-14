/* Couesnon - auth.js
   Client-side Supabase Auth wrapper used by login.html, index.html and app.js.
*/

const SESSION_STORAGE_KEY = 'couesnon_session';
const LOGIN_PAGE = 'login.html';

const ROLE_PERMISSIONS = {
    admin: ['read', 'write', 'manage_users', 'delete', 'manage_ruches'],
    dev: ['read', 'write', 'debug', 'delete', 'manage_ruches'],
    user: ['read']
};

let supabaseClient = null;

function getFrontendConfig() {
    return window.COUESNON_SUPABASE_CONFIG || {};
}

function isConfiguredValue(value) {
    return value && !String(value).startsWith('REPLACE_WITH_');
}

function getSupabaseClient() {
    if (supabaseClient) return supabaseClient;

    const config = getFrontendConfig();
    const url = config.SUPABASE_URL;
    const key = config.SUPABASE_ANON_KEY || config.SUPABASE_PUBLISHABLE_KEY;

    if (!window.supabase?.createClient) {
        throw new Error('La bibliotheque Supabase JS est introuvable.');
    }

    if (!isConfiguredValue(url) || !isConfiguredValue(key)) {
        throw new Error('La configuration Supabase publique est manquante.');
    }

    supabaseClient = window.supabase.createClient(url, key);
    return supabaseClient;
}

function normalizeRole(role) {
    const value = String(role || 'user').trim().toLowerCase();
    if (value === 'apiculteur') return 'user';
    return ROLE_PERMISSIONS[value] ? value : 'user';
}

function getPermissionsForRole(role) {
    return ROLE_PERMISSIONS[normalizeRole(role)] || ROLE_PERMISSIONS.user;
}

function buildSession(user, profile) {
    const role = normalizeRole(profile?.role);
    const email = user.email || '';

    return {
        id: user.id,
        email,
        username: email,
        displayName: profile?.display_name || email,
        role,
        isActive: profile?.is_active !== false,
        loginTime: Date.now()
    };
}

function isValidSession(session) {
    return Boolean(
        session &&
        typeof session.id === 'string' &&
        typeof session.email === 'string' &&
        typeof session.displayName === 'string' &&
        typeof session.role === 'string'
    );
}

const AUTH = {
    async login(email, password) {
        try {
            const client = getSupabaseClient();

            const { data: authData, error: authError } = await client.auth.signInWithPassword({
                email,
                password
            });

            if (authError || !authData?.user) {
                return { success: false, message: 'Email ou mot de passe incorrect' };
            }

            const { data: profile, error: profileError } = await client
                .from('profiles')
                .select('display_name, role, is_active')
                .eq('id', authData.user.id)
                .single();

            if (profileError || !profile) {
                await client.auth.signOut();
                return {
                    success: false,
                    message: 'Profil utilisateur introuvable'
                };
            }

            if (profile.is_active === false) {
                await client.auth.signOut();
                return {
                    success: false,
                    message: 'Compte utilisateur desactive'
                };
            }

            const session = buildSession(authData.user, profile);
            sessionStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(session));

            return { success: true, session };
        } catch (err) {
            console.error('[AUTH] login error:', err);
            return {
                success: false,
                message: err.message || 'Erreur de connexion'
            };
        }
    },

    logout() {
        sessionStorage.removeItem(SESSION_STORAGE_KEY);

        try {
            getSupabaseClient()
                .auth
                .signOut()
                .finally(() => {
                    window.location.href = LOGIN_PAGE;
                });
        } catch {
            window.location.href = LOGIN_PAGE;
        }
    },

    getSession() {
        const raw = sessionStorage.getItem(SESSION_STORAGE_KEY);
        if (!raw) return null;

        try {
            const session = JSON.parse(raw);
            if (!isValidSession(session)) {
                sessionStorage.removeItem(SESSION_STORAGE_KEY);
                return null;
            }

            return session;
        } catch {
            sessionStorage.removeItem(SESSION_STORAGE_KEY);
            return null;
        }
    },

    requireAuth() {
        const session = this.getSession();
        if (!session) {
            window.location.href = LOGIN_PAGE;
            return null;
        }
        return session;
    },

    hasPermission(permission) {
        const session = this.getSession();
        if (!session) return false;

        return getPermissionsForRole(session.role).includes(permission);
    },

    isRole(role) {
        const session = this.getSession();
        if (!session) return false;

        return normalizeRole(session.role) === normalizeRole(role);
    },

    async getAccessToken() {
        try {
            const { data } = await getSupabaseClient().auth.getSession();
            return data?.session?.access_token || null;
        } catch (err) {
            console.warn('[AUTH] access token unavailable:', err);
            return null;
        }
    }
};

window.AUTH = AUTH;
