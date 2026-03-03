import { defineCommand } from "@bunli/core";
import { OutputUtils } from "@listmonk-ops/common";

export default defineCommand({
	name: "examples",
	description: "Show common command examples",
	handler: async () => {
		OutputUtils.info("Listmonk CLI examples");
		console.log(`
# Health check
listmonk-cli status

# Campaigns
listmonk-cli campaigns list
listmonk-cli campaigns get --id 123

# Lists
listmonk-cli lists list
listmonk-cli lists get --id 456

# Subscribers
listmonk-cli subscribers list --page 1 --per-page 20
listmonk-cli subscribers create --email user@example.com --name "User" --lists 1,2

# Templates
listmonk-cli templates create --name "tx-default" --type tx --body "Hello {{ .Subscriber.Email }}"

# Transactional
listmonk-cli tx send --template-id 10 --subscriber-email user@example.com --data '{"name":"User"}'

# A/B test
listmonk-cli abtest interactive --interactive
listmonk-cli abtest create --name "Subject test" --campaign-id 100 --variants '[{"name":"A"},{"name":"B"}]'

# Shell completion
listmonk-cli completions zsh
source <(listmonk-cli completions zsh)
`);
	},
});
