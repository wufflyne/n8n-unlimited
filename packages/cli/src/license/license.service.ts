import { LicenseState, Logger } from '@n8n/backend-common';
import { EventService } from '@n8n/backend-services';
import type { User } from '@n8n/db';
import { WorkflowRepository } from '@n8n/db';
import { Service } from '@n8n/di';
import { ensureError } from '@n8n/utils/errors/ensure-error';

import { BadRequestError } from '@n8n/errors';
import { LicenseEulaRequiredError } from '@/errors/response-errors/license-eula-required.error';
import { License } from '@/license';

export const LicenseErrors = {
	SCHEMA_VALIDATION: 'Activation key is in the wrong format',
	RESERVATION_EXHAUSTED: 'Activation key has been used too many times',
	RESERVATION_EXPIRED: 'Activation key has expired',
	NOT_FOUND: 'Activation key not found',
	RESERVATION_CONFLICT: 'Activation key not found',
	RESERVATION_DUPLICATE: 'Activation key has already been used on this instance',
};

@Service()
export class LicenseService {
	constructor(
		private readonly logger: Logger,
		private readonly license: License,
		private readonly licenseState: LicenseState,
		private readonly workflowRepository: WorkflowRepository,
		private readonly eventService: EventService,
	) {}

	async getLicenseData() {
		const triggerCount = await this.workflowRepository.getActiveTriggerCount();
		const workflowsWithEvaluationsCount =
			await this.workflowRepository.getWorkflowsWithEvaluationCount();

		return {
			usage: {
				activeWorkflowTriggers: {
					value: triggerCount,
					// oxlint-disable-next-line typescript/no-deprecated - Tech debt, tests fail if we move to this.licenseState.getMaxActiveWorkflows
					limit: this.license.getTriggerLimit(),
					warningThreshold: 0.8,
				},
				workflowsHavingEvaluations: {
					value: workflowsWithEvaluationsCount,
					limit: this.licenseState.getMaxWorkflowsWithEvaluations(),
				},
			},
			license: {
				// No cloud entitlements in the local-unlimited build
				planId: '',
				planName: this.license.getPlanName(),
			},
		};
	}

	async requestEnterpriseTrial(_user: User) {
		// Local-unlimited build: trial requests against enterprise.n8n.io are disabled.
	}

	async registerCommunityEdition({
		userId,
		email,
	}: {
		userId: User['id'];
		email: string;
		instanceId: string;
		instanceUrl: string;
		licenseType: string;
	}): Promise<{ title: string; text: string }> {
		// Local-unlimited build: registration against enterprise.n8n.io is disabled.
		this.eventService.emit('license-community-plus-registered', { userId, email });
		return {
			title: 'Community edition registered',
			text: 'This build ships with all enterprise features unlocked locally.',
		};
	}

	getManagementJwt(): string {
		return this.license.getManagementJwt();
	}

	// Overload signatures
	async activateLicense(activationKey: string): Promise<void>;
	async activateLicense(activationKey: string, eulaUri: string, userEmail: string): Promise<void>;
	// Implementation signature
	async activateLicense(
		activationKey: string,
		eulaUri?: string,
		userEmail?: string,
	): Promise<void> {
		try {
			if (eulaUri && userEmail) {
				await this.license.activate(activationKey, eulaUri, userEmail);
			} else if (!eulaUri && !userEmail) {
				await this.license.activate(activationKey);
			} else {
				throw new BadRequestError('When providing eulaUri, userEmail is required');
			}
		} catch (e) {
			// Check if this is a EULA_REQUIRED error from license server
			if (this.isEulaRequiredError(e)) {
				throw new LicenseEulaRequiredError('License activation requires EULA acceptance', {
					eulaUrl: e.info.eula.uri,
				});
			}

			const message = this.mapErrorMessage(ensureError(e), 'activate');
			throw new BadRequestError(message);
		}
	}

	private isEulaRequiredError(
		error: unknown,
	): error is Error & { errorId: string; info: { eula: { uri: string } } } {
		return (
			error instanceof Error &&
			'errorId' in error &&
			error.errorId === 'EULA_REQUIRED' &&
			'info' in error &&
			typeof error.info === 'object' &&
			error.info !== null &&
			'eula' in error.info &&
			typeof error.info.eula === 'object' &&
			error.info.eula !== null &&
			'uri' in error.info.eula &&
			typeof error.info.eula.uri === 'string'
		);
	}

	async renewLicense() {
		if (this.license.getPlanName() === 'Community') return; // unlicensed, nothing to renew

		try {
			await this.license.renew();
		} catch (e) {
			const message = this.mapErrorMessage(ensureError(e), 'renew');

			this.eventService.emit('license-renewal-attempted', { success: false });
			throw new BadRequestError(message);
		}

		this.eventService.emit('license-renewal-attempted', { success: true });
	}

	private mapErrorMessage(error: Error, action: 'activate' | 'renew') {
		let message: string | undefined;

		if (this.isLicenseError(error) && error.errorId in LicenseErrors) {
			message = LicenseErrors[error.errorId as keyof typeof LicenseErrors];
		}

		if (!message) {
			message = `Failed to ${action} license: ${error.message}`;
			this.logger.error(message, { stack: error.stack ?? 'n/a' });
		}
		return message;
	}

	private isLicenseError(error: Error): error is Error & { errorId: string } {
		return 'errorId' in error && typeof error.errorId === 'string';
	}
}
