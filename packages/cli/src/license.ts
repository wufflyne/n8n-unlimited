import type { LicenseProvider } from '@n8n/backend-common';
import { Logger } from '@n8n/backend-common';
import { GlobalConfig } from '@n8n/config';
import {
	LICENSE_FEATURES,
	LICENSE_QUOTAS,
	UNLIMITED_LICENSE_QUOTA,
	type BooleanLicenseFeature,
	type NumericLicenseFeature,
} from '@n8n/constants';
import { SettingsRepository } from '@n8n/db';
import { OnPubSubEvent, OnShutdown } from '@n8n/decorators';
import { Service } from '@n8n/di';
import type { TLicenseBlock } from '@n8n_io/license-sdk';
import { InstanceSettings } from 'n8n-core';

import { SETTINGS_LICENSE_CERT_KEY } from './constants';

export type FeatureReturnType = Partial<
	{ planName: string } & { [K in NumericLicenseFeature]: number } & { [K in BooleanLicenseFeature]: boolean }
>;

type LicenseRefreshCallback = (cert: string) => void;

/**
 * Features that stay **off** in this local-unlimited build:
 * - cloud billing / UBB entitlements (AI usage is billed locally or via a user key)
 * - the non-production license banner
 */
const DISABLED_FEATURES = new Set<BooleanLicenseFeature>([
	LICENSE_FEATURES.AI_CREDITS,
	LICENSE_FEATURES.AI_GATEWAY_CLOUD_UBB,
	LICENSE_FEATURES.AI_ASSISTANT_CLOUD_UBB_ENTITLEMENT,
	LICENSE_FEATURES.SHOW_NON_PROD_BANNER,
]);

/**
 * Quotas that must not report "unlimited":
 * - AI credits / gateway budget belong to cloud billing and stay 0
 * - the evaluation concurrency limit falls through to the tier default
 */
const ZEROED_QUOTAS = new Set<NumericLicenseFeature>([
	LICENSE_QUOTAS.AI_CREDITS,
	LICENSE_QUOTAS.AI_GATEWAY_BUDGET,
	LICENSE_QUOTAS.EVALUATION_CONCURRENCY_LIMIT,
]);

/**
 * Local-unlimited license.
 *
 * This build unlocks every enterprise feature without a license certificate:
 * the license SDK manager is never created, so no license server
 * (license.n8n.io / enterprise.n8n.io / subscription.n8n.io) is ever contacted
 * for activation, renewal or usage reporting. All `feat:*` flags (except those
 * in `DISABLED_FEATURES`) are licensed, all quotas are unlimited and the plan
 * name is "Enterprise".
 */
@Service()
export class License implements LicenseProvider {
	private isShuttingDown = false;

	private refreshCallbacks: LicenseRefreshCallback[] = [];

	constructor(
		private readonly logger: Logger,
		private readonly instanceSettings: InstanceSettings,
		private readonly settingsRepository: SettingsRepository,
		private readonly globalConfig: GlobalConfig,
	) {
		this.logger = this.logger.scoped('license');
	}

	async init(_options: { forceRecreate?: boolean; isCli?: boolean } = {}) {
		if (this.isShuttingDown) {
			this.logger.warn('License manager already shutting down');
			return;
		}
		this.logger.debug('License initialized (local unlimited mode)');
	}

	async loadCertStr(): Promise<TLicenseBlock> {
		const ephemeralLicense = this.globalConfig.license.cert;
		if (ephemeralLicense) {
			return ephemeralLicense;
		}
		const databaseSettings = await this.settingsRepository.findOne({
			where: {
				key: SETTINGS_LICENSE_CERT_KEY,
			},
		});

		return databaseSettings?.value ?? '';
	}

	/**
	 * Register a callback to be notified when license certificate is refreshed.
	 * Returns an unsubscribe function.
	 */
	onCertRefresh(refreshCallback: LicenseRefreshCallback): () => void {
		this.refreshCallbacks.push(refreshCallback);
		return () => {
			const index = this.refreshCallbacks.indexOf(refreshCallback);
			if (index > -1) {
				this.refreshCallbacks.splice(index, 1);
			}
		};
	}

	private async notifyRefreshCallbacks(): Promise<void> {
		const cert = await this.loadCertStr();
		for (const refreshCallback of this.refreshCallbacks) {
			try {
				refreshCallback(cert);
			} catch (error) {
				this.logger.error('Error in license refresh callback', { error });
			}
		}
	}

	async activate(_activationKey: string, _eulaUri?: string, _userEmail?: string): Promise<void> {
		// No-op: activation against a license server is disabled in this build.
	}

	/** Loads the cert another instance stored. Never renews. */
	@OnPubSubEvent('reload-license')
	async reload(): Promise<void> {
		await this.notifyRefreshCallbacks();
		this.logger.debug('License reloaded');
	}

	/** Runs one auto-renewal pass. Never due in this build. */
	async renewIfDue(): Promise<void> {}

	async renew(): Promise<void> {
		// No-op: renewal against a license server is disabled in this build.
	}

	async clear(): Promise<void> {
		this.logger.info('License cleared');
	}

	@OnShutdown()
	async shutdown() {
		this.isShuttingDown = true;
	}

	isLicensed(feature: BooleanLicenseFeature) {
		return !DISABLED_FEATURES.has(feature);
	}

	isCertValid(): boolean {
		return true;
	}

	hasFeatureInCert(feature: BooleanLicenseFeature): boolean {
		return this.isLicensed(feature);
	}

	/** @deprecated Use `LicenseState.isDynamicCredentialsLicensed` instead. */
	isDynamicCredentialsEnabled() {
		return this.isLicensed(LICENSE_FEATURES.DYNAMIC_CREDENTIALS);
	}

	/** @deprecated Use `LicenseState.isSharingLicensed` instead. */
	isSharingEnabled() {
		return this.isLicensed(LICENSE_FEATURES.SHARING);
	}

	/** @deprecated Use `LicenseState.isLogStreamingLicensed` instead. */
	isLogStreamingEnabled() {
		return this.isLicensed(LICENSE_FEATURES.LOG_STREAMING);
	}

	/** @deprecated Use `LicenseState.isLdapLicensed` instead. */
	isLdapEnabled() {
		return this.isLicensed(LICENSE_FEATURES.LDAP);
	}

	/** @deprecated Use `LicenseState.isSamlLicensed` instead. */
	isSamlEnabled() {
		return this.isLicensed(LICENSE_FEATURES.SAML);
	}

	/** @deprecated Use `LicenseState.isAiAssistantLicensed` instead. */
	isAiAssistantEnabled() {
		return this.isLicensed(LICENSE_FEATURES.AI_ASSISTANT);
	}

	/** @deprecated Use `LicenseState.isAskAiLicensed` instead. */
	isAskAiEnabled() {
		return this.isLicensed(LICENSE_FEATURES.ASK_AI);
	}

	/** @deprecated Use `LicenseState.isAiCreditsLicensed` instead. */
	isAiCreditsEnabled() {
		return this.isLicensed(LICENSE_FEATURES.AI_CREDITS);
	}

	/** @deprecated Use `LicenseState.isAdvancedExecutionFiltersLicensed` instead. */
	isAdvancedExecutionFiltersEnabled() {
		return this.isLicensed(LICENSE_FEATURES.ADVANCED_EXECUTION_FILTERS);
	}

	/** @deprecated Use `LicenseState.isAdvancedPermissionsLicensed` instead. */
	isAdvancedPermissionsLicensed() {
		return this.isLicensed(LICENSE_FEATURES.ADVANCED_PERMISSIONS);
	}

	/** @deprecated Use `LicenseState.isDebugInEditorLicensed` instead. */
	isDebugInEditorLicensed() {
		return this.isLicensed(LICENSE_FEATURES.DEBUG_IN_EDITOR);
	}

	/** @deprecated Use `LicenseState.isBinaryDataS3Licensed` instead. */
	isBinaryDataS3Licensed() {
		return this.isLicensed(LICENSE_FEATURES.BINARY_DATA_S3);
	}

	/** @deprecated Use `LicenseState.isMultiMainLicensed` instead. */
	isMultiMainLicensed() {
		return this.isLicensed(LICENSE_FEATURES.MULTIPLE_MAIN_INSTANCES);
	}

	/** @deprecated Use `LicenseState.isVariablesLicensed` instead. */
	isVariablesEnabled() {
		return this.isLicensed(LICENSE_FEATURES.VARIABLES);
	}

	/** @deprecated Use `LicenseState.isSourceControlLicensed` instead. */
	isSourceControlLicensed() {
		return this.isLicensed(LICENSE_FEATURES.SOURCE_CONTROL);
	}

	/** @deprecated Use `LicenseState.isExternalSecretsLicensed` instead. */
	isExternalSecretsEnabled() {
		return this.isLicensed(LICENSE_FEATURES.EXTERNAL_SECRETS);
	}

	/** @deprecated Use `LicenseState.isAPIDisabled` instead. */
	isAPIDisabled() {
		return this.isLicensed(LICENSE_FEATURES.API_DISABLED);
	}

	/** @deprecated Use `LicenseState.isWorkerViewLicensed` instead. */
	isWorkerViewLicensed() {
		return this.isLicensed(LICENSE_FEATURES.WORKER_VIEW);
	}

	/** @deprecated Use `LicenseState.isProjectRoleAdminLicensed` instead. */
	isProjectRoleAdminLicensed() {
		return this.isLicensed(LICENSE_FEATURES.PROJECT_ROLE_ADMIN);
	}

	/** @deprecated Use `LicenseState.isProjectRoleEditorLicensed` instead. */
	isProjectRoleEditorLicensed() {
		return this.isLicensed(LICENSE_FEATURES.PROJECT_ROLE_EDITOR);
	}

	/** @deprecated Use `LicenseState.isProjectRoleViewerLicensed` instead. */
	isProjectRoleViewerLicensed() {
		return this.isLicensed(LICENSE_FEATURES.PROJECT_ROLE_VIEWER);
	}

	/** @deprecated Use `LicenseState.isCustomNpmRegistryLicensed` instead. */
	isCustomNpmRegistryEnabled() {
		return this.isLicensed(LICENSE_FEATURES.COMMUNITY_NODES_CUSTOM_REGISTRY);
	}

	/** @deprecated Use `LicenseState.isFoldersLicensed` instead. */
	isFoldersEnabled() {
		return this.isLicensed(LICENSE_FEATURES.FOLDERS);
	}

	getValue<T extends keyof FeatureReturnType>(feature: T): FeatureReturnType[T] {
		if (feature === 'planName') {
			return 'Enterprise' as FeatureReturnType[T];
		}
		if (feature === (LICENSE_QUOTAS.EVALUATION_CONCURRENCY_LIMIT as T)) {
			// no explicit quota: fall through to the tier default
			return undefined as FeatureReturnType[T];
		}
		if (ZEROED_QUOTAS.has(feature as NumericLicenseFeature)) {
			return 0 as FeatureReturnType[T];
		}
		return UNLIMITED_LICENSE_QUOTA as FeatureReturnType[T];
	}

	getManagementJwt(): string {
		return '';
	}

	getCurrentEntitlements(): [] {
		return [];
	}

	/**
	 * Helper function to get the latest main plan for a license.
	 * No entitlements exist in this build, so this is always `undefined`.
	 */
	getMainPlan(): undefined {
		return undefined;
	}

	getConsumerId() {
		return 'local';
	}

	// Helper functions for computed data

	/** @deprecated Use `LicenseState` instead. */
	getUsersLimit() {
		return this.getValue(LICENSE_QUOTAS.USERS_LIMIT) ?? UNLIMITED_LICENSE_QUOTA;
	}

	/** @deprecated Use `LicenseState` instead. */
	getTriggerLimit() {
		return this.getValue(LICENSE_QUOTAS.TRIGGER_LIMIT) ?? UNLIMITED_LICENSE_QUOTA;
	}

	/** @deprecated Use `LicenseState` instead. */
	getVariablesLimit() {
		return this.getValue(LICENSE_QUOTAS.VARIABLES_LIMIT) ?? UNLIMITED_LICENSE_QUOTA;
	}

	/** @deprecated Use `LicenseState` instead. */
	getAiCredits() {
		return this.getValue(LICENSE_QUOTAS.AI_CREDITS) ?? 0;
	}

	/** @deprecated Use `LicenseState` instead. */
	getWorkflowHistoryPruneLimit() {
		return this.getValue(LICENSE_QUOTAS.WORKFLOW_HISTORY_PRUNE_LIMIT) ?? UNLIMITED_LICENSE_QUOTA;
	}

	/** @deprecated Use `LicenseState` instead. */
	getTeamProjectLimit() {
		return this.getValue(LICENSE_QUOTAS.TEAM_PROJECT_LIMIT) ?? 0;
	}

	getPlanName(): string {
		return 'Enterprise';
	}

	getExpiryDate(): Date | null {
		return null;
	}

	getTerminationDate(): Date | null {
		return null;
	}

	getExpiringInDays(): undefined {
		return undefined;
	}

	getTerminatingInDays(): undefined {
		return undefined;
	}

	getInfo(): string {
		return 'local unlimited license';
	}

	/** @deprecated Use `LicenseState` instead. */
	isWithinUsersLimit() {
		// oxlint-disable-next-line typescript/no-deprecated
		return this.getUsersLimit() === UNLIMITED_LICENSE_QUOTA;
	}
}
