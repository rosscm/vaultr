export function tasteOnboardingEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.VAULTR_TASTE_ONBOARDING_ENABLED?.trim().toLowerCase() === 'true';
}
