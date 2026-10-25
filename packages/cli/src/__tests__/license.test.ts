import { mockLogger } from '@n8n/backend-test-utils';
import type { GlobalConfig } from '@n8n/config';
import { LICENSE_FEATURES, LICENSE_QUOTAS, UNLIMITED_LICENSE_QUOTA } from '@n8n/constants';
import type { SettingsRepository } from '@n8n/db';
import { mock } from 'vitest-mock-extended';

import type { InstanceSettings } from 'n8n-core';

import { License } from '@/license';

const licenseConfig: GlobalConfig['license'] = {
	serverUrl: 'https://server.com/v1',
	autoRenewalEnabled: true,
	detachFloatingOnShutdown: true,
	activationKey: 'activation-key',
	tenantId: 1,
	cert: '',
};

function buildLicense(overrides: { settingsRepository?: SettingsRepository } = {}) {
	const instanceSettings = mock<InstanceSettings>({
		instanceId: 'instance-id',
		instanceType: 'main',
		isLeader: true,
	});
	const globalConfig = mock<GlobalConfig>({
		license: licenseConfig,
		multiMainSetup: { enabled: false },
	});
	return new License(
		mockLogger(),
		instanceSettings,
		overrides.settingsRepository ?? mock(),
		globalConfig,
	);
}

describe('License (local unlimited)', () => {
	let license: License;

	beforeEach(async () => {
		license = buildLicense();
		await license.init();
	});

	describe('init', () => {
		it('does not throw and never contacts a license server', async () => {
			await expect(license.init()).resolves.toBeUndefined();
			await expect(license.init({ forceRecreate: true, isCli: true })).resolves.toBeUndefined();
		});
	});

	describe('isLicensed', () => {
		it('enables every regular feature flag', () => {
			expect(license.isLicensed('feat:sharing')).toBe(true);
			expect(license.isLicensed(LICENSE_FEATURES.LOG_STREAMING)).toBe(true);
			expect(license.isLicensed(LICENSE_FEATURES.SOURCE_CONTROL)).toBe(true);
			expect(license.isLicensed(LICENSE_FEATURES.MULTIPLE_MAIN_INSTANCES)).toBe(true);
		});

		it('keeps cloud-billing and non-prod banner features off', () => {
			expect(license.isLicensed(LICENSE_FEATURES.AI_CREDITS)).toBe(false);
			expect(license.isLicensed(LICENSE_FEATURES.AI_GATEWAY_CLOUD_UBB)).toBe(false);
			expect(license.isLicensed(LICENSE_FEATURES.AI_ASSISTANT_CLOUD_UBB_ENTITLEMENT)).toBe(false);
			expect(license.isLicensed(LICENSE_FEATURES.SHOW_NON_PROD_BANNER)).toBe(false);
		});

		it('reports cert validity and feature-in-cert checks', () => {
			expect(license.isCertValid()).toBe(true);
			expect(license.hasFeatureInCert('feat:sharing')).toBe(true);
			expect(license.hasFeatureInCert(LICENSE_FEATURES.SHOW_NON_PROD_BANNER)).toBe(false);
		});
	});

	describe('getValue', () => {
		it('reports the Enterprise plan name', () => {
			expect(license.getValue('planName')).toBe('Enterprise');
		});

		it('reports unlimited for regular quotas', () => {
			expect(license.getValue(LICENSE_QUOTAS.USERS_LIMIT)).toBe(UNLIMITED_LICENSE_QUOTA);
			expect(license.getValue(LICENSE_QUOTAS.TRIGGER_LIMIT)).toBe(UNLIMITED_LICENSE_QUOTA);
			expect(license.getValue(LICENSE_QUOTAS.VARIABLES_LIMIT)).toBe(UNLIMITED_LICENSE_QUOTA);
			expect(license.getValue(LICENSE_QUOTAS.WORKFLOW_HISTORY_PRUNE_LIMIT)).toBe(
				UNLIMITED_LICENSE_QUOTA,
			);
		});

		it('zeroes cloud-billing quotas', () => {
			expect(license.getValue(LICENSE_QUOTAS.AI_CREDITS)).toBe(0);
			expect(license.getValue(LICENSE_QUOTAS.AI_GATEWAY_BUDGET)).toBe(0);
		});

		it('leaves the evaluation concurrency quota unset', () => {
			expect(license.getValue(LICENSE_QUOTAS.EVALUATION_CONCURRENCY_LIMIT)).toBeUndefined();
		});
	});

	describe('computed values', () => {
		it('exposes plan metadata without a license server', () => {
			expect(license.getPlanName()).toBe('Enterprise');
			expect(license.getConsumerId()).toBe('local');
			expect(license.getInfo()).toBeTypeOf('string');
		});

		it('has no expiry or termination dates', () => {
			expect(license.getExpiryDate()).toBeNull();
			expect(license.getTerminationDate()).toBeNull();
			expect(license.getExpiringInDays()).toBeUndefined();
			expect(license.getTerminatingInDays()).toBeUndefined();
		});

		it('has no entitlements', () => {
			expect(license.getCurrentEntitlements()).toEqual([]);
			expect(license.getMainPlan()).toBeUndefined();
		});

		it('returns an empty management JWT', () => {
			expect(license.getManagementJwt()).toBe('');
		});

		it('is within user limit (unlimited)', () => {
			// oxlint-disable-next-line typescript/no-deprecated
			expect(license.isWithinUsersLimit()).toBe(true);
		});
	});

	describe('no-op lifecycle methods', () => {
		it('activate, renew, renewIfDue and clear resolve without a license server', async () => {
			await expect(license.activate('key')).resolves.toBeUndefined();
			await expect(
				license.activate('key', 'https://eula.example', 'a@b.c'),
			).resolves.toBeUndefined();
			await expect(license.renew()).resolves.toBeUndefined();
			await expect(license.renewIfDue()).resolves.toBeUndefined();
			await expect(license.clear()).resolves.toBeUndefined();
		});
	});

	describe('onCertRefresh', () => {
		it('should register callback and call it on license reload', async () => {
			const callback = vi.fn();
			license.onCertRefresh(callback);

			await license.reload();

			expect(callback).toHaveBeenCalledWith('');
		});

		it('should call multiple registered callbacks', async () => {
			const callback1 = vi.fn();
			const callback2 = vi.fn();

			license.onCertRefresh(callback1);
			license.onCertRefresh(callback2);

			await license.reload();

			expect(callback1).toHaveBeenCalledTimes(1);
			expect(callback2).toHaveBeenCalledTimes(1);
		});

		it('should return unsubscribe function that removes callback', async () => {
			const callback = vi.fn();
			const unsubscribe = license.onCertRefresh(callback);

			unsubscribe();
			await license.reload();

			expect(callback).not.toHaveBeenCalled();
		});

		it('should continue calling other callbacks if one throws', async () => {
			const errorCallback = vi.fn().mockImplementation(() => {
				throw new Error('Callback error');
			});
			const callback2 = vi.fn();

			license.onCertRefresh(errorCallback);
			license.onCertRefresh(callback2);

			await license.reload();

			expect(errorCallback).toHaveBeenCalled();
			expect(callback2).toHaveBeenCalled();
		});

		it('should pass the loaded certificate to callbacks', async () => {
			const settingsRepository = mock<SettingsRepository>();
			settingsRepository.findOne.mockResolvedValue({ value: 'test-cert-value' } as any);

			license = buildLicense({ settingsRepository });
			await license.init();

			const callback = vi.fn();
			license.onCertRefresh(callback);

			await license.reload();

			expect(callback).toHaveBeenCalledWith('test-cert-value');
		});

		it('should prefer an ephemeral cert from the config', async () => {
			const instanceSettings = mock<InstanceSettings>({
				instanceId: 'instance-id',
				instanceType: 'main',
				isLeader: true,
			});
			const globalConfig = mock<GlobalConfig>({
				license: { ...licenseConfig, cert: 'ephemeral-cert' },
				multiMainSetup: { enabled: false },
			});
			const settingsRepository = mock<SettingsRepository>();
			license = new License(mockLogger(), instanceSettings, settingsRepository, globalConfig);
			await license.init();

			const callback = vi.fn();
			license.onCertRefresh(callback);
			await license.reload();

			expect(callback).toHaveBeenCalledWith('ephemeral-cert');
			expect(settingsRepository.findOne).not.toHaveBeenCalled();
		});
	});
});
