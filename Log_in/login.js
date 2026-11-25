/* =========================================
   PYNX ERP — Login
   1. Signs the user in (Supabase Auth)
   2. Reads the department from "profiles"
   3. Opens that department's workspace
========================================= */

/* Department -> page (path is relative to the Log_in folder) */
const DEPARTMENT_ROUTES = {
    "admin": "../Admin/admin_dashboard.html",
    "finance": "../Finance/finance_dashboard.html",
    "marketing": "../Marketing/marketing_dashboard.html",
    "procurement": "../Procurement/procurement_dashboard.html",
    "inventory": "../Inventory/inventory_dashboard.html",
    "logistics": "../Logistics/logistics_dashboard.html"
};

/* When only a username is typed, these domains are tried in order */
const EMAIL_DOMAINS = ["@pynx.web", "@phynx.web"];

/* Usernames whose email does not follow the normal pattern */
const EMAIL_OVERRIDES = {
    "logictics": "logictics@pynx.web",
    "logistics": "logictics@pynx.web"
};

/* Messages for when a department page sends the user back here */
const REASON_MESSAGES = {
    "signin": "Please log in to continue.",
    "denied": "This account does not have access to that workspace.",
    "noprofile": "No department profile found for this account."
};

const KNOWN_DEPARTMENTS = Object.keys(DEPARTMENT_ROUTES);

const loginForm = document.getElementById("loginForm");
const usernameInput = document.getElementById("email");
const passwordInput = document.getElementById("password");
const errorMessage = document.getElementById("errorMessage");
const loginButton = document.getElementById("loginButton");


/* =========================================
   HELPERS
========================================= */

function showError(message) {
    errorMessage.textContent = message;
}

function setLoading(isLoading) {
    loginButton.disabled = isLoading;
    loginButton.style.opacity = isLoading ? "0.7" : "1";
    loginButton.style.cursor = isLoading ? "not-allowed" : "pointer";
}

/* "Marketing", " MARKETING ", "Marketing & Design" -> "marketing" */
function normalizeDepartment(value) {
    const text = String(value || "").trim().toLowerCase();

    if (KNOWN_DEPARTMENTS.includes(text)) return text;
    if (text.includes("logictics")) return "logistics";
    if (text.includes("purchas")) return "procurement";

    const match = KNOWN_DEPARTMENTS.find(function (key) {
        return text.includes(key);
    });
    return match || text;
}

/* List of emails to try for what the user typed */
function emailCandidates(typed) {
    const value = typed.trim().toLowerCase();
    if (value.includes("@")) return [value];
    if (EMAIL_OVERRIDES[value]) return [EMAIL_OVERRIDES[value]];
    return EMAIL_DOMAINS.map(function (domain) { return value + domain; });
}

/* Tries each email until one signs in */
async function signIn(typed, password) {
    let lastError = null;
    const emails = emailCandidates(typed);

    for (let i = 0; i < emails.length; i++) {
        const { data, error } = await window.supabaseClient.auth.signInWithPassword({
            email: emails[i],
            password: password
        });
        if (!error && data && data.user) return { user: data.user, error: null };
        lastError = error;
    }
    return { user: null, error: lastError };
}

function friendlyAuthError(authError) {
    const msg = String((authError && authError.message) || "").toLowerCase();

    if (msg.includes("invalid login")) return "Invalid email or password.";
    if (msg.includes("email not confirmed")) {
        return "This email is not confirmed yet. Confirm the user in Supabase (Authentication → Users).";
    }
    if (msg.includes("failed to fetch") || msg.includes("network")) {
        return "Cannot reach the server. Check your internet connection and ../config/supabase.js.";
    }
    return (authError && authError.message) || "Invalid email or password.";
}

/* Show a message if a department page redirected here with ?reason=... */
(function showReasonFromUrl() {
    const reason = new URLSearchParams(window.location.search).get("reason");
    if (reason && REASON_MESSAGES[reason]) {
        showError(REASON_MESSAGES[reason]);
        window.history.replaceState(null, "", window.location.pathname);
    }
})();


/* =========================================
   LOGIN
========================================= */

loginForm.addEventListener("submit", async function (event) {
    event.preventDefault();
    showError("");
    setLoading(true);

    if (!window.supabaseClient) {
        showError("Cannot connect to the database. Check ../config/supabase.js.");
        setLoading(false);
        return;
    }

    const typed = usernameInput.value;
    const password = passwordInput.value;

    if (!typed.trim() || !password) {
        showError("Enter your email and password.");
        setLoading(false);
        return;
    }

    try {
        // 1. Sign in with Supabase Auth
        const { user, error: authError } = await signIn(typed, password);

        if (!user) {
            showError(friendlyAuthError(authError));
            setLoading(false);
            return;
        }

        // 2. Get the user's department from the profiles table
        const { data: profile, error: profileError } =
            await window.supabaseClient
                .from("profiles")
                .select("username, department, role")
                .eq("id", user.id)
                .maybeSingle();

        if (profileError) {
            await window.supabaseClient.auth.signOut();
            showError("Could not load your profile: " + profileError.message);
            setLoading(false);
            return;
        }

        if (!profile || !profile.department) {
            await window.supabaseClient.auth.signOut();
            showError("No department profile found for this account.");
            setLoading(false);
            return;
        }

        // 3. Redirect to the correct department page
        const department = normalizeDepartment(profile.department);
        const destination = DEPARTMENT_ROUTES[department];

        if (!destination) {
            await window.supabaseClient.auth.signOut();
            showError("No workspace is assigned to the department \"" + profile.department + "\".");
            setLoading(false);
            return;
        }

        window.location.href = destination;

    } catch (err) {
        console.error(err);
        showError("Something went wrong. Please try again.");
        setLoading(false);
    }
});