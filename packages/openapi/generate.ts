import { createClient } from '@hey-api/openapi-ts';

createClient({
  input: 'https://listmonk.app/docs/swagger/collections.yaml',
  output: 'generated',
  plugins: [
    '@hey-api/typescript',
    '@hey-api/sdk'
  ],
  parser: {

  }
});