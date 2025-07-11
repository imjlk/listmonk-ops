import { OutputUtils } from "@listmonk-ops/common";
import { defineCommand } from "../lib/definition";

export const meta = defineCommand({
	name: "examples",
	description: "Show usage examples",
	runner: "simple",
});

export function run() {
	OutputUtils.info("📚 Usage Examples:");
	console.log(`
🧪 A/B/C Testing:
  # Create an A/B test (auto-assigns 50/50 split)
  listmonk-cli abtest create \
    --name "Subject Line Test" \
    --campaign-id "123" \
    --variants '[{"name":"Control"},{"name":"Variant B"}]'
  
  # Create an A/B test with custom percentages
  listmonk-cli abtest create \
    --name "Subject Line Test" \
    --campaign-id "123" \
    --variants '[{"name":"Control","percentage":50},{"name":"Variant B","percentage":50}]'
  
  # Create an A/B/C test (auto-assigns 33.33/33.33/33.33 split)
  listmonk-cli abtest create \
    --name "Email Design Test" \
    --campaign-id "456" \
    --variants '[{"name":"Original"},{"name":"Colorful"},{"name":"Minimal"}]'
  
  # Create an A/B/C test with custom percentages
  listmonk-cli abtest create \
    --name "CTA Button Test" \
    --campaign-id "789" \
    --variants '[{"name":"Blue Button","percentage":40},{"name":"Red Button","percentage":30},{"name":"Green Button","percentage":30}]'
  
  # Analyze test results
  listmonk-cli abtest analyze --test-id test_1234567890

📧 Campaign Management:
  # List all campaigns
  listmonk-cli campaigns list
  
  # Get campaign details
  listmonk-cli campaigns get --id 123

📝 List Management:
  # List all subscriber lists
  listmonk-cli lists list
  
  # Get list details
  listmonk-cli lists get --id 456

🔧 System:
  # Check status
  listmonk-cli status

📖 Environment Setup:
  export LISTMONK_API_URL="http://localhost:9000/api"
  export LISTMONK_USERNAME="admin"
  export LISTMONK_PASSWORD="your-password"
  # OR
  export LISTMONK_API_TOKEN="your-api-token"
`);
}
