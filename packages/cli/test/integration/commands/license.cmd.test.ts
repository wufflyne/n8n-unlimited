import { mockInstance } from '@n8n/backend-test-utils';
import { Container } from '@n8n/di';

import { ClearLicenseCommand } from '@/commands/license/clear';
import { License } from '@/license';
import { LoadNodesAndCredentials } from '@/load-nodes-and-credentials';
import { setupTestCommand } from '@test-integration/utils/test-command';

mockInstance(LoadNodesAndCredentials);
const command = setupTestCommand(ClearLicenseCommand);

test('license:clear initializes the license and invokes clear()', async () => {
	const license = Container.get(License);

	const initSpy = vi.spyOn(license, 'init').mockResolvedValue();
	const clearSpy = vi.spyOn(license, 'clear').mockResolvedValue();

	await command.run();

	expect(initSpy).toHaveBeenCalledTimes(1);
	expect(initSpy).toHaveBeenCalledWith({ isCli: true });
	expect(clearSpy).toHaveBeenCalledTimes(1);
});
