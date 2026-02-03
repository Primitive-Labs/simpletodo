<script setup lang="ts">
/**
 * Handles the OAuth and magic link callback redirect flows.
 *
 * Supports profile completion and passkey registration prompts for new users.
 */
import { startRegistration } from "@simplewebauthn/browser";
import type { PublicKeyCredentialCreationOptionsJSON } from "@simplewebauthn/types";
import {
  AlertTriangle,
  Camera,
  Clock,
  Key,
  Loader2,
  Lock,
  Mail,
  User,
  X,
} from "lucide-vue-next";
import type { Component } from "vue";
import { computed, onMounted, ref } from "vue";
import { useRouter } from "vue-router";
import { appBaseLogger } from "@/lib/logger";
import { buildRouteOrUrl, resolveRouteOrUrl } from "@/lib/routeOrUrl";
import { isIOS } from "@/lib/utils";
import { jsBaoClientService } from "primitive-app";
import { AUTH_CODES, useUserStore } from "@/stores/userStore";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Label } from "../ui/label";
import PrimitiveLogoSpinner from "@/components/shared/PrimitiveLogoSpinner.vue";

type CallbackState =
  | "processing"
  | "profile-completion"
  | "passkey-prompt"
  | "passkey-registering"
  | "passkey-success"
  | "passkey-error"
  | "waitlisted"
  | "access-denied"
  | "link-expired"
  | "resending-link"
  | "link-resent"
  | "redirecting"
  | "error";

interface Props {
  /**
   * Absolute/path URL to continue to after successful OAuth callback.
   * Either `continueURL` or `continueRoute` must be provided.
   */
  continueURL?: string;
  /**
   * Named route to continue to after successful OAuth callback.
   * Either `continueURL` or `continueRoute` must be provided.
   */
  continueRoute?: string;
  /**
   * Absolute/path login URL used when redirecting on error.
   * Either `loginUrl` or `loginRoute` must be provided.
   */
  loginUrl?: string;
  /**
   * Named login route used when redirecting on error.
   * Either `loginUrl` or `loginRoute` must be provided.
   */
  loginRoute?: string;
  /**
   * Optional loading component to display while handling the OAuth callback.
   * Defaults to `PrimitiveLogoSpinner` when not provided.
   */
  loadingComponent?: Component;

  // Profile completion options
  /**
   * Whether to show the name field if user.name is blank.
   * @default true
   */
  requestName?: boolean;
  /**
   * Whether name is required before continuing.
   * @default false
   */
  requireName?: boolean;
  /**
   * Whether to show the avatar field if user.avatarUrl is blank.
   * @default true
   */
  requestAvatar?: boolean;
  /**
   * Whether avatar is required before continuing.
   * @default false
   */
  requireAvatar?: boolean;

  // Passkey prompt options
  /**
   * Whether to prompt user to add a passkey if they have none.
   * @default true
   */
  promptForPasskey?: boolean;
}

const props = withDefaults(defineProps<Props>(), {
  promptForPasskey: true,
  requestName: true,
  requireName: false,
  requestAvatar: true,
  requireAvatar: false,
});

const user = useUserStore();
const router = useRouter();
const logger = appBaseLogger.forScope("PrimitiveOauthCallback");

// Profile config from props
const effectiveConfig = computed(() => ({
  requestName: props.requestName,
  requireName: props.requireName,
  requestAvatar: props.requestAvatar,
  requireAvatar: props.requireAvatar,
}));

// State
const callbackState = ref<CallbackState>("processing");
const errorMessage = ref<string | null>(null);
const redirectTo = ref<string>("/");
const isNewUser = ref(false);

// Profile completion state
const userName = ref("");
const userAvatarFile = ref<File | null>(null);
const userAvatarPreview = ref<string | null>(null);
const isProfileSaving = ref(false);
const profileError = ref<string | null>(null);

// Passkey state
const passkeyDeviceName = ref("");
const passkeyError = ref<string | null>(null);

// Magic link resend state
const expiredLinkEmail = ref<string | null>(null);
const isResendingLink = ref(false);
const resendError = ref<string | null>(null);

// Access denied state
const accessDeniedMessage = ref<string | null>(null);

// Computed
const authConfig = computed(() => user.authConfig);

// Detect iOS for "Open Mail" button (works in Safari, Chrome, and other iOS browsers)
const showOpenMailButton = computed(() => isIOS());

/**
 * Check if profile completion form should be shown.
 * @param forNewUser - Whether this is a new user (passed explicitly to avoid reactivity timing issues)
 */
function checkNeedsProfileCompletion(forNewUser: boolean): boolean {
  const currentUser = user.currentUser;
  const config = effectiveConfig.value;

  logger.debug("checkNeedsProfileCompletion called", {
    forNewUser,
    hasCurrentUser: !!currentUser,
    currentUserName: currentUser?.name,
    currentUserEmail: currentUser?.email,
    config: {
      requestName: config.requestName,
      requireName: config.requireName,
      requestAvatar: config.requestAvatar,
      requireAvatar: config.requireAvatar,
    },
  });

  if (!currentUser) {
    logger.debug(
      "checkNeedsProfileCompletion: no currentUser, returning false"
    );
    return false;
  }

  // Only show profile completion for new users, not returning users with missing fields
  if (!forNewUser) {
    logger.debug(
      "checkNeedsProfileCompletion: existing user, skipping profile completion"
    );
    return false;
  }

  // For new users: show if ANY profile field is configured
  const result = config.requestName || config.requestAvatar;
  logger.debug("checkNeedsProfileCompletion: new user check", {
    requestName: config.requestName,
    requestAvatar: config.requestAvatar,
    result,
  });
  return result;
}

const canContinueProfile = computed(() => {
  const currentUser = user.currentUser;

  // Check name requirement
  const nameBlank = !currentUser?.name || currentUser.name.trim() === "";
  if (
    effectiveConfig.value.requireName &&
    nameBlank &&
    !userName.value.trim()
  ) {
    return false;
  }

  // Check avatar requirement
  const avatarBlank = !currentUser?.avatarUrl;
  if (
    effectiveConfig.value.requireAvatar &&
    avatarBlank &&
    !userAvatarFile.value
  ) {
    return false;
  }

  return true;
});

// Computed to check if we should show the name field
const showNameField = computed(() => {
  if (!effectiveConfig.value.requestName) return false;
  // For new users, always show the name field so they can customize it
  if (isNewUser.value) return true;
  // For existing users, only show if blank
  const currentUser = user.currentUser;
  return !currentUser?.name || currentUser.name.trim() === "";
});

// Computed to check if we should show the avatar field
const showAvatarField = computed(() => {
  if (!effectiveConfig.value.requestAvatar) return false;
  // For new users, always show the avatar field so they can set it
  if (isNewUser.value) return true;
  // For existing users, only show if blank
  const currentUser = user.currentUser;
  return !currentUser?.avatarUrl;
});

// Methods
async function handleCallback(): Promise<void> {
  const callbackLogger = logger.forScope("handleCallback");

  try {
    const continueTarget = buildRouteOrUrl(
      props.continueURL,
      props.continueRoute
    );
    const loginTarget = buildRouteOrUrl(props.loginUrl, props.loginRoute);

    const defaultContinueUrl = resolveRouteOrUrl(router, continueTarget);
    const loginUrl = resolveRouteOrUrl(router, loginTarget);

    callbackLogger.debug("Callback configured URLs:", {
      href: typeof window !== "undefined" ? window.location.href : "",
      defaultContinueUrl,
      loginUrl,
    });

    const result = await user.handleOAuthCallback(defaultContinueUrl, loginUrl);

    callbackLogger.debug("Callback result:", result);

    if (!result.ok) {
      // Check for waitlisted state
      if (
        result.waitlisted ||
        result.errorCode === AUTH_CODES.ADDED_TO_WAITLIST
      ) {
        callbackState.value = "waitlisted";
        return;
      }

      // Check for invitation required (invite-only mode, no waitlist)
      // Detect by error code or by message content
      const msgLower = result.errorMessage?.toLowerCase() || "";
      if (
        result.errorCode === AUTH_CODES.INVITATION_REQUIRED ||
        msgLower.includes("invitation") ||
        msgLower.includes("invite-only") ||
        msgLower.includes("invite only")
      ) {
        accessDeniedMessage.value =
          "This app is invite-only. You need an invitation to sign in.";
        callbackState.value = "access-denied";
        redirectTo.value = result.redirectTo;
        return;
      }

      // Check for domain not allowed
      // Detect by error code or by message content
      if (
        result.errorCode === AUTH_CODES.DOMAIN_NOT_ALLOWED ||
        msgLower.includes("domain") ||
        msgLower.includes("email domain")
      ) {
        accessDeniedMessage.value =
          "You need to sign in with an approved email domain to access this app.";
        callbackState.value = "access-denied";
        redirectTo.value = result.redirectTo;
        return;
      }

      // Check for expired/used magic link token
      if (result.tokenExpiredOrUsed) {
        expiredLinkEmail.value = result.email || null;
        redirectTo.value = result.redirectTo;
        callbackState.value = "link-expired";
        return;
      }

      errorMessage.value = "Authentication failed";
      callbackState.value = "error";
      redirectTo.value = result.redirectTo;
      return;
    }

    redirectTo.value = result.redirectTo;

    // Store isNewUser flag for profile completion logic
    const newUserFlag = result.isNewUser ?? false;
    isNewUser.value = newUserFlag;

    callbackLogger.debug("Post-callback flow starting", {
      isNewUser: newUserFlag,
      promptAddPasskey: result.promptAddPasskey,
      hasCurrentUser: !!user.currentUser,
    });

    // STEP 1: Check if we need profile completion (pass flag explicitly to avoid reactivity timing issues)
    // Profile completion should ALWAYS come before passkey prompt for new users
    callbackLogger.debug("STEP 1: Checking profile completion...");
    const needsProfile = checkNeedsProfileCompletion(newUserFlag);
    callbackLogger.debug("STEP 1 result: needsProfile =", needsProfile);

    if (needsProfile) {
      callbackLogger.debug("Profile completion needed - showing form", {
        isNewUser: newUserFlag,
        requestName: effectiveConfig.value.requestName,
        requestAvatar: effectiveConfig.value.requestAvatar,
      });
      // For new users, start with blank name so they can enter their preferred display name
      // For existing users, pre-fill with their current name
      userName.value = newUserFlag ? "" : user.currentUser?.name || "";
      // Generate suggested device name for later passkey prompt
      passkeyDeviceName.value = user.getSuggestedDeviceName();
      callbackState.value = "profile-completion";
      return;
    }

    // STEP 2: Check if we should prompt for passkey (only after profile completion is done)
    callbackLogger.debug("STEP 2: Checking passkey prompt...");
    const shouldPromptPasskey = await checkShouldPromptPasskey(
      result.promptAddPasskey
    );
    callbackLogger.debug(
      "STEP 2 result: shouldPromptPasskey =",
      shouldPromptPasskey
    );

    if (shouldPromptPasskey) {
      callbackLogger.debug("Passkey prompt needed - showing prompt");
      passkeyDeviceName.value = user.getSuggestedDeviceName();
      callbackState.value = "passkey-prompt";
      return;
    }

    // All done, redirect
    callbackLogger.debug(
      "Callback complete; redirecting to:",
      redirectTo.value
    );
    callbackState.value = "redirecting";
    router.push(redirectTo.value);
  } catch (err: unknown) {
    callbackLogger.error("Callback error:", err);
    handleError(err);
  }
}

async function checkShouldPromptPasskey(
  promptAddPasskey?: boolean
): Promise<boolean> {
  if (!props.promptForPasskey) return false;
  if (!authConfig.value?.hasPasskey) return false;

  // If the server explicitly says to prompt
  if (promptAddPasskey) return true;

  // Otherwise, check if user has any passkeys
  try {
    const passkeys = await user.listPasskeys();
    return passkeys.length === 0;
  } catch (e) {
    logger.warn("Failed to check passkeys:", e);
    return false;
  }
}

function handleError(err: unknown): void {
  // Check for specific auth error codes
  if (err && typeof err === "object" && "code" in err) {
    const code = (err as { code: string }).code;

    if (code === AUTH_CODES.ADDED_TO_WAITLIST) {
      callbackState.value = "waitlisted";
      return;
    }

    if (code === AUTH_CODES.INVITATION_REQUIRED) {
      errorMessage.value =
        "This app is invite-only. You need an invitation to sign in.";
      callbackState.value = "error";
      return;
    }

    if (code === AUTH_CODES.DOMAIN_NOT_ALLOWED) {
      errorMessage.value = "Your email domain is not allowed for this app.";
      callbackState.value = "error";
      return;
    }
  }

  errorMessage.value =
    err instanceof Error ? err.message : "An error occurred during sign-in";
  callbackState.value = "error";
}

async function handleProfileSubmit(): Promise<void> {
  const profileLogger = logger.forScope("handleProfileSubmit");

  if (!canContinueProfile.value) return;

  profileLogger.debug("Submitting profile", {
    name: userName.value,
    hasAvatar: !!userAvatarFile.value,
  });

  isProfileSaving.value = true;
  profileError.value = null;

  try {
    // Upload avatar first if provided
    if (userAvatarFile.value) {
      profileLogger.debug("Uploading avatar...");
      const contentType = getAvatarContentType(userAvatarFile.value.type);
      if (!contentType) {
        throw new Error(
          "Unsupported image format. Please use PNG, JPEG, GIF, or WebP."
        );
      }
      await user.uploadAvatar(userAvatarFile.value, contentType);
      profileLogger.debug("Avatar uploaded successfully");
    }

    // Update name if provided and changed
    if (userName.value.trim()) {
      profileLogger.debug("Updating profile name...");
      await user.updateProfile({ name: userName.value.trim() });
      profileLogger.debug("Profile name updated successfully");
    }

    // Check if we should prompt for passkey
    const shouldPromptPasskey = await checkShouldPromptPasskey();
    if (shouldPromptPasskey) {
      profileLogger.debug("Passkey prompt needed after profile");
      callbackState.value = "passkey-prompt";
      return;
    }

    // All done, redirect
    callbackState.value = "redirecting";
    router.push(redirectTo.value);
  } catch (err: unknown) {
    profileLogger.error("Profile save error:", err);
    profileError.value =
      err instanceof Error ? err.message : "Failed to save profile";
  } finally {
    isProfileSaving.value = false;
  }
}

/**
 * Get the content type for avatar upload from the file's MIME type.
 */
function getAvatarContentType(
  mimeType: string
): "image/png" | "image/jpeg" | "image/gif" | "image/webp" | null {
  const validTypes = ["image/png", "image/jpeg", "image/gif", "image/webp"];
  if (validTypes.includes(mimeType)) {
    return mimeType as "image/png" | "image/jpeg" | "image/gif" | "image/webp";
  }
  return null;
}

/**
 * Handle avatar file selection.
 */
function handleAvatarSelect(event: Event): void {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];

  if (!file) return;

  // Validate file type
  const contentType = getAvatarContentType(file.type);
  if (!contentType) {
    profileError.value =
      "Unsupported image format. Please use PNG, JPEG, GIF, or WebP.";
    return;
  }

  // Validate file size (max 20MB - will be auto-resized to fit server limit)
  const maxSize = 20 * 1024 * 1024;
  if (file.size > maxSize) {
    profileError.value = "Image is too large. Maximum size is 20MB.";
    return;
  }

  profileError.value = null;
  userAvatarFile.value = file;

  // Create preview URL
  if (userAvatarPreview.value) {
    URL.revokeObjectURL(userAvatarPreview.value);
  }
  userAvatarPreview.value = URL.createObjectURL(file);
}

/**
 * Clear the selected avatar.
 */
function clearAvatarSelection(): void {
  userAvatarFile.value = null;
  if (userAvatarPreview.value) {
    URL.revokeObjectURL(userAvatarPreview.value);
    userAvatarPreview.value = null;
  }
}

function skipProfile(): void {
  // Only allow skip if name is not required
  if (effectiveConfig.value.requireName && !userName.value.trim()) return;

  handleAfterProfile();
}

async function handleAfterProfile(): Promise<void> {
  const shouldPromptPasskey = await checkShouldPromptPasskey();
  if (shouldPromptPasskey) {
    passkeyDeviceName.value = user.getSuggestedDeviceName();
    callbackState.value = "passkey-prompt";
    return;
  }

  callbackState.value = "redirecting";
  router.push(redirectTo.value);
}

async function handleAddPasskey(): Promise<void> {
  const passkeyLogger = logger.forScope("handleAddPasskey");

  passkeyLogger.debug("Starting passkey registration", {
    deviceName: passkeyDeviceName.value,
  });

  callbackState.value = "passkey-registering";
  passkeyError.value = null;

  try {
    // Get registration options
    const { options, challengeToken } = await user.startPasskeyRegistration();

    // Start WebAuthn registration
    const credential = await startRegistration({
      optionsJSON: options as PublicKeyCredentialCreationOptionsJSON,
    });

    // Complete registration
    await user.registerPasskey(
      credential,
      challengeToken,
      passkeyDeviceName.value || undefined
    );

    passkeyLogger.debug("Passkey registered successfully");
    callbackState.value = "passkey-success";

    // Brief success message, then redirect
    setTimeout(() => {
      callbackState.value = "redirecting";
      router.push(redirectTo.value);
    }, 1500);
  } catch (err: unknown) {
    passkeyLogger.error("Passkey registration error:", err);

    // Handle user cancellation
    if (err instanceof Error && err.name === "NotAllowedError") {
      passkeyError.value = "Passkey setup was cancelled";
      callbackState.value = "passkey-error";
      return;
    }

    // Handle not supported
    if (err instanceof Error && err.name === "NotSupportedError") {
      passkeyError.value = "Passkeys aren't supported on this device";
      callbackState.value = "passkey-error";
      return;
    }

    passkeyError.value =
      err instanceof Error ? err.message : "Something went wrong. Try again?";
    callbackState.value = "passkey-error";
  }
}

function skipPasskey(): void {
  logger.debug("User skipped passkey setup");
  callbackState.value = "redirecting";
  router.push(redirectTo.value);
}

function retryPasskey(): void {
  callbackState.value = "passkey-prompt";
  passkeyError.value = null;
}

async function handleResendLink(): Promise<void> {
  if (!expiredLinkEmail.value) {
    goToLogin();
    return;
  }

  const resendLogger = logger.forScope("handleResendLink");
  resendLogger.debug("Resending magic link to:", expiredLinkEmail.value);

  isResendingLink.value = true;
  resendError.value = null;

  try {
    // Get the base redirect URI from js-bao config
    const config = jsBaoClientService.getConfig();
    const baseRedirectUri = config?.oauthRedirectUri;

    if (!baseRedirectUri) {
      throw new Error("Redirect URI not configured");
    }

    // Encode state with email and continue URL (same as login page does)
    // This allows the resend flow to work if this new link also expires
    const state = btoa(
      JSON.stringify({
        continueUrl: redirectTo.value,
        email: expiredLinkEmail.value,
      })
    );
    const separator = baseRedirectUri.includes("?") ? "&" : "?";
    const redirectUriWithState = `${baseRedirectUri}${separator}state=${encodeURIComponent(state)}`;

    await user.requestMagicLink(expiredLinkEmail.value, redirectUriWithState);
    resendLogger.debug("Magic link resent successfully");
    callbackState.value = "link-resent";
  } catch (err: unknown) {
    resendLogger.error("Failed to resend magic link:", err);
    resendError.value =
      err instanceof Error ? err.message : "Failed to send link";
  } finally {
    isResendingLink.value = false;
  }
}

function goToLogin(): void {
  const loginTarget = buildRouteOrUrl(props.loginUrl, props.loginRoute);
  const loginUrl = resolveRouteOrUrl(router, loginTarget);
  router.push(loginUrl);
}

// Validation helpers
function validateRouteExists(routeName: string, propName: string): boolean {
  try {
    router.resolve({ name: routeName });
    return true;
  } catch {
    logger.error(
      `Invalid ${propName}: route "${routeName}" does not exist. ` +
        `Check that the route is defined in your router configuration.`
    );
    return false;
  }
}

// Lifecycle
onMounted(() => {
  // Validate route props early to catch configuration errors
  if (props.continueRoute) {
    validateRouteExists(props.continueRoute, "continueRoute");
  }
  if (props.loginRoute) {
    validateRouteExists(props.loginRoute, "loginRoute");
  }

  handleCallback();
});
</script>

<template>
  <!-- Processing State -->
  <div
    v-if="callbackState === 'processing' || callbackState === 'redirecting'"
    class="min-h-screen flex items-center justify-center"
  >
    <component :is="props.loadingComponent || PrimitiveLogoSpinner" />
  </div>

  <!-- Profile Completion State -->
  <div
    v-else-if="callbackState === 'profile-completion'"
    class="min-h-screen flex items-center justify-center p-6"
  >
    <div class="w-full max-w-sm space-y-6">
      <div class="text-center space-y-2">
        <div
          class="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-primary/10"
        >
          <User class="h-8 w-8 text-primary" />
        </div>
        <h1 class="text-2xl font-semibold">
          Welcome! Let's set up your profile
        </h1>
      </div>

      <form @submit.prevent="handleProfileSubmit" class="space-y-4">
        <!-- Name field -->
        <div v-if="showNameField" class="space-y-2">
          <Label for="name">
            Your name
            <span v-if="effectiveConfig.requireName" class="text-destructive"
              >*</span
            >
          </Label>
          <Input
            id="name"
            v-model="userName"
            type="text"
            placeholder="Enter your name"
            :disabled="isProfileSaving"
            class="h-12"
            autofocus
          />
        </div>

        <!-- Profile picture field -->
        <div v-if="showAvatarField" class="space-y-2">
          <Label>
            Profile picture
            <span v-if="effectiveConfig.requireAvatar" class="text-destructive"
              >*</span
            >
            <span v-else class="text-muted-foreground text-sm">(optional)</span>
          </Label>
          <div class="flex items-center gap-4">
            <!-- Avatar preview or placeholder -->
            <div class="relative">
              <div
                v-if="userAvatarPreview"
                class="h-16 w-16 rounded-full overflow-hidden"
              >
                <img
                  :src="userAvatarPreview"
                  alt="Avatar preview"
                  class="h-full w-full object-cover"
                />
              </div>
              <div
                v-else
                class="h-16 w-16 rounded-full bg-muted flex items-center justify-center"
              >
                <Camera class="h-6 w-6 text-muted-foreground" />
              </div>
              <!-- Clear button -->
              <button
                v-if="userAvatarPreview"
                type="button"
                @click="clearAvatarSelection"
                class="absolute -top-1 -right-1 h-5 w-5 flex items-center justify-center bg-background rounded-full text-muted-foreground hover:text-foreground"
                :disabled="isProfileSaving"
              >
                <X class="h-4 w-4" />
              </button>
            </div>
            <!-- File input -->
            <div>
              <input
                type="file"
                id="avatar-input"
                accept="image/png,image/jpeg,image/gif,image/webp"
                class="sr-only"
                :disabled="isProfileSaving"
                @change="handleAvatarSelect"
              />
              <label
                for="avatar-input"
                class="cursor-pointer inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-medium ring-offset-background transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 border border-input bg-background hover:bg-accent hover:text-accent-foreground h-9 px-3"
                :class="{ 'pointer-events-none opacity-50': isProfileSaving }"
              >
                {{ userAvatarPreview ? "Change photo" : "Choose photo" }}
              </label>
            </div>
          </div>
        </div>

        <!-- Error display -->
        <div
          v-if="profileError"
          class="rounded-md bg-destructive/10 p-3 text-sm text-destructive"
        >
          {{ profileError }}
        </div>

        <Button
          type="submit"
          :disabled="!canContinueProfile || isProfileSaving"
          class="w-full h-12"
        >
          <Loader2 v-if="isProfileSaving" class="mr-2 h-4 w-4 animate-spin" />
          Continue
        </Button>
      </form>
    </div>
  </div>

  <!-- Passkey Prompt State -->
  <div
    v-else-if="callbackState === 'passkey-prompt'"
    class="min-h-screen flex items-center justify-center p-6"
  >
    <div class="w-full max-w-sm space-y-6 text-center">
      <div class="space-y-2">
        <div
          class="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-primary/10"
        >
          <Key class="h-8 w-8 text-primary" />
        </div>
        <h1 class="text-2xl font-semibold">Add a passkey for faster sign-in</h1>
        <p class="text-muted-foreground text-sm">
          Passkeys let you sign in securely with your fingerprint, face, or
          device PIN. No passwords needed!
        </p>
      </div>

      <div class="space-y-3">
        <div class="space-y-2">
          <Label for="deviceName" class="text-left block">
            Name this passkey
          </Label>
          <Input
            id="deviceName"
            v-model="passkeyDeviceName"
            type="text"
            placeholder="e.g., MacBook Pro"
            class="h-12"
          />
        </div>

        <Button @click="handleAddPasskey" class="w-full h-12">
          Add passkey
        </Button>

        <Button
          variant="ghost"
          @click="skipPasskey"
          class="w-full text-muted-foreground"
        >
          Skip for now
        </Button>
      </div>
    </div>
  </div>

  <!-- Passkey Registering State -->
  <div
    v-else-if="callbackState === 'passkey-registering'"
    class="min-h-screen flex items-center justify-center p-6"
  >
    <div class="w-full max-w-sm space-y-6 text-center">
      <Loader2 class="mx-auto h-12 w-12 animate-spin text-primary" />
      <p class="text-muted-foreground">Setting up your passkey...</p>
      <p class="text-muted-foreground text-sm">
        Follow the prompts from your browser or device.
      </p>
    </div>
  </div>

  <!-- Passkey Success State -->
  <div
    v-else-if="callbackState === 'passkey-success'"
    class="min-h-screen flex items-center justify-center p-6"
  >
    <div class="w-full max-w-sm space-y-6 text-center">
      <div
        class="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-green-500/10"
      >
        <Key class="h-8 w-8 text-green-500" />
      </div>
      <div class="space-y-2">
        <h1 class="text-2xl font-semibold">Passkey added!</h1>
        <p class="text-muted-foreground text-sm">
          You can now use this passkey to sign in faster.
        </p>
      </div>
    </div>
  </div>

  <!-- Passkey Error State -->
  <div
    v-else-if="callbackState === 'passkey-error'"
    class="min-h-screen flex items-center justify-center p-6"
  >
    <div class="w-full max-w-sm space-y-6 text-center">
      <div
        class="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-amber-500/10"
      >
        <Key class="h-8 w-8 text-amber-500" />
      </div>
      <div class="space-y-2">
        <h1 class="text-xl font-semibold">{{ passkeyError }}</h1>
      </div>
      <div class="flex flex-col gap-2">
        <Button @click="retryPasskey" variant="outline" class="w-full">
          Try again
        </Button>
        <Button
          @click="skipPasskey"
          variant="ghost"
          class="w-full text-muted-foreground"
        >
          Skip for now
        </Button>
      </div>
    </div>
  </div>

  <!-- Waitlisted State -->
  <div
    v-else-if="callbackState === 'waitlisted'"
    class="min-h-screen flex items-center justify-center p-6"
  >
    <div class="w-full max-w-sm space-y-6 text-center">
      <div
        class="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-amber-500/10"
      >
        <Clock class="h-8 w-8 text-amber-500" />
      </div>
      <div class="space-y-2">
        <h1 class="text-2xl font-semibold">You're on the waitlist</h1>
        <p class="text-muted-foreground text-sm">
          We've added you to the waitlist. We'll send you an email when your
          access is approved.
        </p>
      </div>
      <Button @click="goToLogin" variant="outline" class="w-full">
        Back to sign in
      </Button>
    </div>
  </div>

  <!-- Access Denied State (invite required, domain not allowed) -->
  <div
    v-else-if="callbackState === 'access-denied'"
    class="min-h-screen flex items-center justify-center p-6"
  >
    <div class="w-full max-w-sm space-y-6 text-center">
      <div
        class="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-muted"
      >
        <Lock class="h-8 w-8 text-muted-foreground" />
      </div>
      <div class="space-y-2">
        <h1 class="text-2xl font-semibold">Access Denied</h1>
        <p class="text-muted-foreground text-sm">
          {{ accessDeniedMessage }}
        </p>
      </div>
      <Button @click="goToLogin" variant="outline" class="w-full">
        Back to sign in
      </Button>
    </div>
  </div>

  <!-- Link Expired/Used State -->
  <div
    v-else-if="callbackState === 'link-expired'"
    class="min-h-screen flex items-center justify-center p-6"
  >
    <div class="w-full max-w-sm space-y-6 text-center">
      <div
        class="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-amber-500/10"
      >
        <AlertTriangle class="h-8 w-8 text-amber-500" />
      </div>
      <div class="space-y-2">
        <h1 class="text-2xl font-semibold">Link expired</h1>
        <p class="text-muted-foreground text-sm">
          This sign-in link has already been used or has expired.
        </p>
        <p v-if="expiredLinkEmail" class="text-muted-foreground text-sm">
          Send a new link to
          <span class="font-medium text-foreground">{{
            expiredLinkEmail
          }}</span>
        </p>
      </div>

      <!-- Error display -->
      <div
        v-if="resendError"
        class="rounded-md bg-destructive/10 p-3 text-sm text-destructive"
      >
        {{ resendError }}
      </div>

      <!-- Resend button (when we have email) -->
      <Button
        v-if="expiredLinkEmail"
        @click="handleResendLink"
        :disabled="isResendingLink"
        class="w-full"
      >
        <Loader2 v-if="isResendingLink" class="mr-2 h-4 w-4 animate-spin" />
        <Mail v-else class="mr-2 h-4 w-4" />
        {{ isResendingLink ? "Sending..." : "Send new link" }}
      </Button>

      <!-- Fallback to login (when no email) -->
      <Button v-else @click="goToLogin" class="w-full">
        <Mail class="mr-2 h-4 w-4" />
        Back to sign in
      </Button>
    </div>
  </div>

  <!-- Link Resent State -->
  <div
    v-else-if="callbackState === 'link-resent'"
    class="min-h-screen flex items-center justify-center p-6"
  >
    <div class="w-full max-w-sm space-y-6 text-center">
      <div
        class="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-green-500/10"
      >
        <Mail class="h-8 w-8 text-green-500" />
      </div>
      <div class="space-y-2">
        <h1 class="text-2xl font-semibold">Check your email</h1>
        <p class="text-muted-foreground text-sm">
          We've sent a new sign-in link to
          <span class="font-medium text-foreground">{{
            expiredLinkEmail
          }}</span>
        </p>
      </div>
      <Button
        v-if="showOpenMailButton"
        as="a"
        href="message://"
        class="w-full gap-2"
      >
        <Mail class="mr-2 h-4 w-4" />
        Open Mail
      </Button>
      <Button @click="goToLogin" variant="outline" class="w-full">
        Back to sign in
      </Button>
    </div>
  </div>

  <!-- Error State -->
  <div
    v-else-if="callbackState === 'error'"
    class="min-h-screen flex items-center justify-center p-6"
  >
    <div class="w-full max-w-sm space-y-6 text-center">
      <div
        class="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-destructive/10"
      >
        <span class="text-3xl">⚠️</span>
      </div>
      <div class="space-y-2">
        <h1 class="text-xl font-semibold">Something went wrong</h1>
        <p class="text-muted-foreground text-sm">
          {{ errorMessage || "An error occurred during sign-in." }}
        </p>
      </div>
      <Button @click="goToLogin" variant="outline" class="w-full">
        Back to sign in
      </Button>
    </div>
  </div>
</template>
