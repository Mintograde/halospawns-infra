# Frontend Site Deployment Plan

This plan adds infrastructure and deployment automation for the sibling frontend project at `../halospawns-svelte`.

The goal is to deploy the Vite/Svelte frontend as static assets to a private S3 bucket served by CloudFront, with deployments initiated by GitHub Actions in the `halospawns-svelte` repository through GitHub OIDC. Both repositories are expected to be public, so the design must not use long-lived AWS access keys.

Security update, 2026-07-29: frontend Basic Auth remains an SSM
`SecureString`, but its parameter and real value are externally lifecycle
managed. Historical Terraform snippets below that create a placeholder
parameter are superseded and must not be restored.

## Current Context

Update, 2026-07-28: prod foundation work resumed under the protected soft
rollout in `PROD_SOFT_ROLLOUT.md`. `new.halospawns.com` now has its own prod
S3/CloudFront/ACM/DNS stack behind Basic Auth. The bucket awaits the first
`halospawns-svelte` prod preview deployment. Historical "prod paused" notes
below describe the earlier planning state and do not override the new runbook.

Infra repository:

- Path: `L:\bens_stuff\projects\halospawns-infra`
- Atmos dev component split is complete.
- Prod bootstrap and protected preview foundation are implemented.
- Dev components are split and clean:
  - `tfstate-backend`
  - `uploads-ingest`
  - `ecr`
  - `map-processing`
  - `current-games`

Frontend repository:

- Path: `L:\bens_stuff\projects\halospawns-svelte`
- Vite/Svelte project.
- Build command from `package.json`: `npm run build`
- Test command from `package.json`: `npm run test`
- Expected Vite build output directory: `dist`

AWS account layout:

- Management account: `halospawns-mgmt` (`862739531359`)
- Development account: `halospawns-dev` (`283279960672`)
- Production account: `halospawns-prod` (`659571592246`)

Existing public website:

- `https://www.halospawns.com` is the current canonical site.
- `https://halospawns.com` redirects to `https://www.halospawns.com`.
- The existing site was created manually in the `halospawns-mgmt` account.
- Existing resources include a CloudFront distribution, S3 static website bucket, and Route 53 records.
- Do not import, destroy, or repoint those resources as part of the dev frontend work.
- The eventual prod frontend deployment should replace this site by changing DNS for `halospawns.com` and `www.halospawns.com` after prod infrastructure is ready.

DNS posture:

- Temporary environment-specific names are acceptable and preferred for dev.
- `dev.halospawns.com` is the best initial target if Route 53 delegation is in scope.
- If DNS work is deferred, deploy with the CloudFront default domain first and add aliases later.

## Target Architecture

Add a new Terraform component in this infra repository:

```text
components/terraform/frontend-site
```

This component should provision:

- Private S3 bucket for frontend build artifacts.
- S3 bucket encryption, versioning, and public access block.
- CloudFront origin access control for the S3 origin.
- CloudFront distribution for the frontend.
- Bucket policy allowing only the CloudFront distribution to read objects.
- Optional ACM certificate and DNS records for a custom frontend domain.
- Optional delegated hosted zone support for `dev.halospawns.com`.
- GitHub Actions OIDC deploy role scoped to the `halospawns-svelte` repo.

The frontend repository should get a workflow:

```text
../halospawns-svelte/.github/workflows/deploy-dev.yml
```

The workflow should:

- Run on pushes to the chosen deployment branch and on manual dispatch.
- Build and test the Vite app.
- Assume the AWS deploy role using GitHub OIDC.
- Upload `dist` assets to S3 with appropriate cache headers.
- Create a CloudFront invalidation.

## Ownership Decision

The infra repo owns all AWS infrastructure.

The frontend repo owns:

- frontend source code,
- frontend build,
- frontend test,
- asset upload,
- CloudFront invalidation trigger.

The frontend repo should not run Terraform.

## Naming

Recommended component name:

```text
frontend-site
```

Recommended dev state key:

```text
dev/frontend-site/terraform.tfstate
```

Recommended bucket naming pattern:

```text
halospawns-frontend-<environment>-<account-id>
```

Recommended dev domain options:

```text
dev.halospawns.com
app-dev.halospawns.com
```

Recommended first choice:

```text
dev.halospawns.com
```

If a custom domain is not ready, deploy first using the CloudFront default domain name and add aliases/DNS later. Avoid touching `halospawns.com` or `www.halospawns.com` until the prod cutover plan is explicit.

## Route 53 Strategy

Recommended approach:

- Keep the registered domain and parent public hosted zone for `halospawns.com` authoritative in `halospawns-mgmt`.
- Delegate environment subzones from the management account to the owning environment accounts:
  - `dev.halospawns.com` delegated to a public hosted zone in `halospawns-dev`.
  - `prod.halospawns.com` delegated to a public hosted zone in `halospawns-prod` when prod work resumes.
- Use delegated environment zones for temporary environment sites, ACM DNS validation records, and other environment-scoped DNS.
- Keep `halospawns.com` and `www.halospawns.com` in the management account until the final production website cutover.

Why this is the preferred shape:

- The management account remains the stable owner of the public domain and legacy production website.
- Dev and prod infrastructure can manage their own environment records without requiring broad Route 53 permissions into the parent zone.
- The production apex and `www` cutover can be a small, deliberate DNS change instead of a side effect of deploying the frontend component.

Alternative approaches:

- A management-account DNS component can own all `halospawns.com` records and read outputs from environment deployments. This is centralized, but it requires cross-account output passing or manual inputs.
- Moving the parent `halospawns.com` hosted zone to `halospawns-prod` is possible later, but it is not recommended now because the existing website and DNS live in `halospawns-mgmt`.

CloudFront and ACM details:

- Any ACM certificate used by CloudFront must be created in `us-east-1` and in the same AWS account as the CloudFront distribution.
- DNS validation records can live in the delegated environment zone when using `dev.halospawns.com` or `prod.halospawns.com`.
- Apex and `www` production records should not be changed until prod infrastructure has been verified and a rollback target is documented.

## Dev Privacy Toggle

The dev frontend should support a lightweight privacy mode so it can be public when convenient and lightly gated when the user wants to avoid random discovery.

Recommended path of least resistance:

- Add an optional Lambda@Edge function on the viewer-request event.
- Store the expected Basic Auth credential in SSM Parameter Store as a `SecureString`.
- Let the Lambda@Edge function read the SSM parameter at runtime and cache it in memory for a short TTL.
- When privacy mode is disabled, do not associate the Lambda@Edge function with the distribution.
- When privacy mode is enabled, require browser-native HTTP Basic Auth.
- Toggle the behavior with a Terraform variable and apply `frontend-site`.

Recommended modes:

```text
public
basic_auth
```

Default for dev should be:

```text
basic_auth
```

Switching dev public temporarily should only require changing:

```yaml
access_control_mode: public
```

and applying:

```powershell
.\scripts\apply.ps1 dev frontend-site
```

Switching it back should set:

```yaml
access_control_mode: basic_auth
```

and re-apply the same component.

Basic Auth behavior:

- Lambda@Edge checks the incoming `Authorization` header.
- On cold start, cache expiry, or credential rotation window, Lambda@Edge reads the expected credential from SSM with decryption enabled.
- If it matches the configured Basic Auth value, the request continues.
- If it does not match, CloudFront returns `401` with `WWW-Authenticate`.
- Browsers will show a built-in username/password prompt.

Important limitations:

- This is a convenience gate, not a strong security boundary.
- Do not put sensitive data on the dev site just because Basic Auth is enabled.
- Do not commit the real Basic Auth credential to this public repository.
- Lambda@Edge can make network calls, but every SSM read adds latency and cost. Cache the SSM value in the function execution environment.
- Lambda@Edge execution environments are distributed, so each edge location may refresh the credential independently.
- Credential rotation is not instant everywhere; use a short cache TTL if fast rotation matters.

Credential handling:

- Terraform should create the SSM `SecureString` parameter initially with a placeholder value.
- Do not create the parameter with an ad hoc script or manual console action; the parameter resource belongs in Terraform.
- Store the parameter in `us-east-1` to keep it aligned with the Lambda@Edge function and CloudFront/ACM operational region.
- The public stack YAML should include the parameter name, but not the actual credential.
- After Terraform creates the parameter, manually overwrite it in SSM with the real Base64-encoded `username:password` value.
- The SSM parameter resource should use `lifecycle.ignore_changes = [value]` so Terraform does not replace the manually managed credential.
- The Lambda@Edge execution role should have `ssm:GetParameter` on this exact parameter ARN.
- If a customer-managed KMS key is used, the Lambda@Edge execution role also needs `kms:Decrypt` on that key.

Recommended parameter name:

```text
/halospawns/dev/frontend-site/basic-auth/credentials-base64
```

Safest first-time setup:

1. Apply `frontend-site` with `create_basic_auth_ssm_parameter: true`, `create_basic_auth_edge_lambda: true`, and `access_control_mode: public` so Terraform creates the SSM parameter and Lambda@Edge function without associating it to CloudFront yet.
2. Manually overwrite the SSM parameter with the real Base64-encoded value.
3. Change `access_control_mode` to `basic_auth`.
4. Re-apply `frontend-site` so CloudFront associates the published Lambda@Edge version.
5. Later credential rotations only require updating SSM; no Terraform apply is needed, though edge caches may take up to the configured TTL to refresh.

Use the repository helper script:

```powershell
.\scripts\set-frontend-basic-auth-password.ps1 dev
```

The script:

- Generates a fresh random 12-character alphabetic password on every run.
- Uses username `dev` by default.
- Checks that `/halospawns/dev/frontend-site/basic-auth/credentials-base64` already exists.
- Writes only the Base64-encoded `username:password` value to SSM.
- Prints the generated username/password once.
- Is intentionally dev-only and hardcodes the dev profile, region, SSM parameter name, and username.

Manual equivalent:

```powershell
$raw = "dev:<dev-password>"
$bytes = [System.Text.Encoding]::ASCII.GetBytes($raw)
$encoded = [Convert]::ToBase64String($bytes)

aws ssm get-parameter `
  --profile halospawns-dev `
  --region us-east-1 `
  --name "/halospawns/dev/frontend-site/basic-auth/credentials-base64" `
  --no-with-decryption

aws ssm put-parameter `
  --profile halospawns-dev `
  --region us-east-1 `
  --name "/halospawns/dev/frontend-site/basic-auth/credentials-base64" `
  --type SecureString `
  --value $encoded `
  --overwrite
```

The `get-parameter` command is intentionally first. If it fails because the parameter does not exist, stop and apply `frontend-site` with `create_basic_auth_ssm_parameter: true` before running `put-parameter`.

Future alternatives if needed:

- Add an AWS WAF web ACL with an IP allowlist for stricter network-based access.
- Add a Lambda@Edge shared-header check for non-browser tooling.
- Use a separate non-indexed hostname and keep Basic Auth enabled.

## Module Recommendations

This addition is reusable enough to justify modules.

### Module: `modules/static-site`

Create:

```text
modules/static-site/
  data.tf
  main.tf
  outputs.tf
  providers.tf
  variables.tf
```

Owns:

- `aws_s3_bucket`
- `aws_s3_bucket_versioning`
- `aws_s3_bucket_server_side_encryption_configuration`
- `aws_s3_bucket_public_access_block`
- `aws_cloudfront_origin_access_control`
- `aws_cloudfront_distribution`
- `aws_s3_bucket_policy`
- optional `aws_acm_certificate`
- optional `aws_route53_record`
- optional `aws_acm_certificate_validation`

Inputs:

```text
project
environment
bucket_prefix
domain_name
aliases
acm_certificate_arn
create_certificate
hosted_zone_id
default_root_object
spa_fallback_enabled
access_control_mode
viewer_request_lambda_qualified_arn
price_class
tags
```

Outputs:

```text
bucket_name
bucket_arn
bucket_regional_domain_name
cloudfront_distribution_id
cloudfront_distribution_arn
cloudfront_domain_name
cloudfront_hosted_zone_id
site_url
access_control_mode
```

Key implementation details:

- Use a private S3 REST origin, not S3 website hosting.
- Use CloudFront OAC, not legacy OAI.
- The S3 bucket policy should allow `s3:GetObject` only for the CloudFront distribution ARN.
- Enable SPA fallback:

  ```text
  403 -> /index.html, response code 200
  404 -> /index.html, response code 200
  ```

- Keep allowed methods narrow:

  ```text
  GET, HEAD, OPTIONS
  ```

- Use HTTPS redirect at CloudFront.
- Prefer managed CloudFront cache policies unless a custom policy is needed.
- If the site needs custom headers later, add a response headers policy in this module.
- Support `access_control_mode = "public"` with no viewer-request gate.
- Support `access_control_mode = "basic_auth"` by associating `viewer_request_lambda_qualified_arn` as a Lambda@Edge viewer-request function.
- Validate that `viewer_request_lambda_qualified_arn` is provided when `access_control_mode = "basic_auth"`.
- Do not use Basic Auth for prod unless there is an explicit reason; prod should normally be public behind CloudFront.

Do not reuse `modules/s3-bucket` directly for the site. That module currently includes upload-oriented behavior such as CORS and metadata configuration. A static website bucket has different policy, CORS, and CloudFront requirements.

### Module: `modules/lambda-edge-basic-auth`

Create this module if dev privacy mode is implemented with SSM-backed Basic Auth.

Create:

```text
modules/lambda-edge-basic-auth/
  auth.js.tftpl
  data.tf
  main.tf
  outputs.tf
  providers.tf
  variables.tf
```

Owns:

- SSM `SecureString` placeholder parameter for the Basic Auth credential.
- IAM role for Lambda@Edge with `lambda.amazonaws.com` and `edgelambda.amazonaws.com` trust principals.
- IAM policy allowing `ssm:GetParameter` on the exact credential parameter ARN.
- Optional `kms:Decrypt` permission when a customer-managed KMS key is used for the parameter.
- Lambda zip package.
- Lambda function in `us-east-1`.
- Published Lambda function version for CloudFront association.

Inputs:

```text
project
environment
function_name
ssm_parameter_name
create_ssm_parameter
ssm_placeholder_value
ssm_kms_key_id
ssm_region
basic_auth_realm
credential_cache_ttl_seconds
tags
```

Outputs:

```text
lambda_function_name
lambda_function_arn
lambda_function_qualified_arn
ssm_parameter_name
ssm_parameter_arn
credential_cache_ttl_seconds
```

Key implementation details:

- The Lambda@Edge function must be created in `us-east-1`.
- CloudFront must associate a numbered, published Lambda version, not `$LATEST` or an alias.
- The Lambda execution role must trust both `lambda.amazonaws.com` and `edgelambda.amazonaws.com`.
- Do not use Lambda environment variables; Lambda@Edge does not support normal environment variables.
- Do not use Lambda layers; Lambda@Edge does not support layers.
- Do not put the function in a VPC.
- Use a zip-based `x86_64` Lambda package, not a container image or `arm64`.
- Package `@aws-sdk/client-ssm` directly in the zip; do not rely on a runtime-provided SDK.
- The SSM parameter value should be the Base64-encoded `username:password` portion only, not the full `Basic ...` header.
- Use `lifecycle.ignore_changes = [value]` on the SSM parameter so Terraform does not replace the manually managed credential.
- Set `ssm_placeholder_value` to a sentinel that the function refuses, such as `REPLACE_ME_DO_NOT_USE`, not to a working default credential.
- Use the default AWS-managed SSM KMS key unless `ssm_kms_key_id` is provided.
- Keep `credential_cache_ttl_seconds` short enough for useful rotation. A practical default is `300`.

Lambda@Edge function shape:

```javascript
const crypto = require("crypto");
const { SSMClient, GetParameterCommand } = require("@aws-sdk/client-ssm");

const parameterName = "${ssm_parameter_name}";
const ssmRegion = "${ssm_region}";
const realm = "${basic_auth_realm}";
const cacheTtlMs = ${credential_cache_ttl_seconds} * 1000;
const placeholderValue = "${ssm_placeholder_value}";

const ssm = new SSMClient({ region: ssmRegion });
let cachedCredential = null;
let cachedUntil = 0;

function unauthorized() {
  return {
    status: "401",
    statusDescription: "Unauthorized",
    headers: {
      "www-authenticate": [{ key: "WWW-Authenticate", value: `Basic realm="${realm}"` }],
      "cache-control": [{ key: "Cache-Control", value: "no-store" }]
    }
  };
}

function unavailable() {
  return {
    status: "503",
    statusDescription: "Service Unavailable",
    headers: {
      "cache-control": [{ key: "Cache-Control", value: "no-store" }]
    }
  };
}

function timingSafeEqual(a, b) {
  const left = Buffer.from(a || "");
  const right = Buffer.from(b || "");
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}

async function getExpectedHeader() {
  const now = Date.now();
  if (cachedCredential && now < cachedUntil) {
    return `Basic ${cachedCredential}`;
  }

  const response = await ssm.send(new GetParameterCommand({
    Name: parameterName,
    WithDecryption: true
  }));

  const value = response.Parameter && response.Parameter.Value;
  if (!value || value === placeholderValue) {
    throw new Error("Basic Auth credential is not configured");
  }

  cachedCredential = value.trim();
  cachedUntil = now + cacheTtlMs;
  return `Basic ${cachedCredential}`;
}

exports.handler = async (event) => {
  const request = event.Records[0].cf.request;
  const authHeader = request.headers.authorization && request.headers.authorization[0].value;

  let expectedHeader;
  try {
    expectedHeader = await getExpectedHeader();
  } catch (error) {
    console.error("Unable to load Basic Auth credential from SSM");
    return unavailable();
  }

  if (timingSafeEqual(authHeader, expectedHeader)) {
    return request;
  }

  return unauthorized();
};
```

Function behavior:

- Cache the SSM value in module-global memory for `credential_cache_ttl_seconds`.
- Fail closed with `503` if the SSM value cannot be loaded or still equals the placeholder sentinel.
- Return `401` only when the credential is configured and the viewer did not provide the right header.
- Never log the supplied `Authorization` header or the expected credential.
- Use `crypto.timingSafeEqual` after checking buffer lengths.
- Expect eventual consistency during credential rotation because edge execution environments refresh independently.

Terraform association:

```hcl
lambda_function_association {
  event_type   = "viewer-request"
  lambda_arn   = var.viewer_request_lambda_qualified_arn
  include_body = false
}
```

Operational notes:

- Updating the SSM parameter rotates the password without a Terraform apply.
- Existing edge execution environments may continue using the cached value until `credential_cache_ttl_seconds` expires.
- Updating the Lambda code or static configuration requires publishing a new Lambda version and updating the CloudFront association.
- Lambda@Edge replica cleanup can lag after distribution updates; avoid frequent create/destroy cycles.

### Optional Module: `modules/delegated-hosted-zone`

Create this only if Route 53 delegation is automated now. If DNS is deferred, skip this module and use the CloudFront default distribution domain.

Create:

```text
modules/delegated-hosted-zone/
  data.tf
  main.tf
  outputs.tf
  providers.tf
  variables.tf
```

Owns:

- Child public hosted zone in the environment account.
- NS delegation record in the parent `halospawns.com` hosted zone in `halospawns-mgmt`.

Provider model:

- Default `aws` provider points at the environment account, such as `halospawns-dev`.
- Aliased `aws.parent` provider points at `halospawns-mgmt`.

Inputs:

```text
zone_name
parent_zone_name
parent_zone_id
tags
```

Outputs:

```text
zone_id
zone_name
name_servers
delegation_record_fqdn
```

Implementation notes:

- This is useful for `dev.halospawns.com` and future `prod.halospawns.com`.
- Do not use this module for apex `halospawns.com`; apex and `www` stay in the management account until cutover.
- If cross-account Route 53 automation is not desirable yet, create the child hosted zone in the environment account and add the NS record in `halospawns-mgmt` manually as a documented one-time step.

### Module: `modules/github-actions-deploy-role`

Create:

```text
modules/github-actions-deploy-role/
  data.tf
  main.tf
  outputs.tf
  providers.tf
  variables.tf
```

Owns:

- GitHub OIDC deploy IAM role.
- Inline or attached IAM policy for S3 upload and CloudFront invalidation.
- Optionally the account-level GitHub OIDC provider.

Inputs:

```text
project
environment
github_repository
github_environment
github_branch
github_oidc_provider_arn
create_github_oidc_provider
site_bucket_name
site_bucket_arn
cloudfront_distribution_arn
tags
```

Outputs:

```text
deploy_role_arn
deploy_role_name
github_oidc_provider_arn
```

Trust policy options:

Preferred if using GitHub Environments:

```text
repo:<owner>/halospawns-svelte:environment:dev
```

Alternative if not using GitHub Environments:

```text
repo:<owner>/halospawns-svelte:ref:refs/heads/main
```

Always require:

```text
token.actions.githubusercontent.com:aud = sts.amazonaws.com
```

Deploy role permissions should be limited to:

- `s3:ListBucket` on the site bucket.
- `s3:GetObject`, `s3:PutObject`, `s3:DeleteObject` on site bucket objects.
- `cloudfront:CreateInvalidation` on the site distribution.
- Optionally `cloudfront:GetInvalidation` if the workflow waits for invalidation completion.

Do not grant broad S3 or CloudFront permissions.

OIDC provider note:

`aws_iam_openid_connect_provider` for `https://token.actions.githubusercontent.com` is account-level. If it already exists in the AWS account, import it or pass its ARN instead of creating a duplicate. This should be handled deliberately in the module variables.

Implemented import target after the component is wired:

```text
module.github_deploy_role.aws_iam_openid_connect_provider.github[0]
```

For dev, prefer setting `create_github_oidc_provider: false` and passing `github_oidc_provider_arn` if the provider already exists and should not be imported into this component state.

## New Component Layout

Create:

```text
components/terraform/frontend-site/
  backend.tf
  main.tf
  outputs.tf
  providers.tf
  variables.tf
```

Suggested `main.tf` shape:

```hcl
locals {
  basic_auth_enabled = var.access_control_mode == "basic_auth"
}

module "basic_auth_edge" {
  count  = var.create_basic_auth_edge_lambda ? 1 : 0
  source = "../../../modules/lambda-edge-basic-auth"

  project      = var.project
  environment  = var.environment
  function_name = "${var.project}-${var.environment}-frontend-basic-auth"

  ssm_parameter_name          = var.basic_auth_ssm_parameter_name
  create_ssm_parameter        = var.create_basic_auth_ssm_parameter
  ssm_placeholder_value       = var.basic_auth_ssm_placeholder_value
  ssm_kms_key_id              = var.basic_auth_ssm_kms_key_id
  ssm_region                  = "us-east-1"
  basic_auth_realm            = var.basic_auth_realm
  credential_cache_ttl_seconds = var.basic_auth_cache_ttl_seconds
}

module "site" {
  source = "../../../modules/static-site"

  project      = var.project
  environment  = var.environment
  bucket_prefix = "${var.project}-frontend"

  domain_name          = var.domain_name
  aliases              = var.domain_name == null ? [] : [var.domain_name]
  acm_certificate_arn  = var.acm_certificate_arn
  create_certificate   = var.create_certificate
  hosted_zone_id       = var.hosted_zone_id
  spa_fallback_enabled = true
  access_control_mode  = var.access_control_mode

  viewer_request_lambda_qualified_arn = local.basic_auth_enabled ? module.basic_auth_edge[0].lambda_function_qualified_arn : null
}

module "github_deploy_role" {
  source = "../../../modules/github-actions-deploy-role"

  project     = var.project
  environment = var.environment

  github_repository  = var.github_repository
  github_environment = var.github_environment
  github_branch      = var.github_branch

  create_github_oidc_provider = var.create_github_oidc_provider
  github_oidc_provider_arn    = var.github_oidc_provider_arn

  site_bucket_name           = module.site.bucket_name
  site_bucket_arn            = module.site.bucket_arn
  cloudfront_distribution_arn = module.site.cloudfront_distribution_arn
}
```

Suggested component outputs:

```text
site_bucket_name
cloudfront_distribution_id
cloudfront_distribution_domain_name
cloudfront_distribution_arn
site_url
access_control_mode
basic_auth_ssm_parameter_name
basic_auth_lambda_qualified_arn
deploy_role_arn
```

## Stack Configuration

Update `stacks/dev.yaml`:

```yaml
frontend-site:
  metadata:
    component: frontend-site
  vars:
    github_repository: <owner>/halospawns-svelte
    github_environment: dev
    github_branch: main
    domain_name: null
    hosted_zone_id: null
    acm_certificate_arn: null
    create_certificate: false
    access_control_mode: basic_auth
    basic_auth_realm: Halospawns dev
    basic_auth_ssm_parameter_name: /halospawns/dev/frontend-site/basic-auth/credentials-base64
    create_basic_auth_ssm_parameter: true
    basic_auth_ssm_placeholder_value: REPLACE_ME_DO_NOT_USE
    basic_auth_ssm_kms_key_id: null
    create_basic_auth_edge_lambda: true
    basic_auth_cache_ttl_seconds: 300
    create_github_oidc_provider: true
    github_oidc_provider_arn: null
  backend_type: s3
  backend:
    s3:
      bucket: halospawns-tfstate-283279960672
      key: dev/frontend-site/terraform.tfstate
      region: us-east-1
      profile: halospawns-dev
      use_lockfile: true
```

Adjust the variables before applying:

- Replace `<owner>/halospawns-svelte` with the actual GitHub repo owner/name.
- Set `domain_name` and DNS variables only if custom domain support is being implemented now.
- Keep `access_control_mode: basic_auth` when the dev site should be lightly private.
- For the first bootstrap, temporarily set `access_control_mode: public` until the SSM parameter has been overwritten with the real value.
- Change `access_control_mode` to `public` and re-apply `frontend-site` when the dev site should be openly reachable.
- Do not commit the real Basic Auth value. Terraform should create the SSM parameter with the placeholder value, then the real value should be written manually to SSM.
- `basic_auth_ssm_placeholder_value` is intentionally non-secret and should not be a working credential.
- Leave `basic_auth_ssm_kms_key_id: null` to use the default AWS-managed SSM KMS key.
- Keep `basic_auth_cache_ttl_seconds` short enough for credential rotation. `300` is a practical default.
- If the GitHub OIDC provider already exists, set `create_github_oidc_provider: false` and pass `github_oidc_provider_arn`.

Do not enable this in `stacks/prod.yaml` until prod bootstrap work resumes.

## Workflow Updates In Infra Repo

Update full dev workflows so `frontend-site` is included.

Recommended order:

```text
tfstate-backend
frontend-site
uploads-ingest
ecr
map-processing
current-games
```

Files:

```text
stacks/workflows/plan.yaml
stacks/workflows/apply.yaml
scripts/init.ps1
```

Add `frontend-site` to:

- `plan-dev`
- `apply-dev`
- the component list in `scripts/init.ps1`

Single-component commands should work automatically once the stack entry exists:

```powershell
.\scripts\plan.ps1 dev frontend-site
.\scripts\apply.ps1 dev frontend-site
```

## Frontend GitHub Workflow

Add this file in the frontend repo:

```text
../halospawns-svelte/.github/workflows/deploy-dev.yml
```

Initial workflow:

```yaml
name: Deploy dev

on:
  push:
    branches:
      - main
  workflow_dispatch:

permissions:
  contents: read
  id-token: write

concurrency:
  group: deploy-dev
  cancel-in-progress: true

jobs:
  deploy:
    name: Build and deploy dev
    runs-on: ubuntu-latest
    environment: dev

    env:
      AWS_REGION: ${{ vars.AWS_REGION }}
      SITE_BUCKET: ${{ vars.DEV_SITE_BUCKET }}
      CLOUDFRONT_DISTRIBUTION_ID: ${{ vars.DEV_CLOUDFRONT_DISTRIBUTION_ID }}

    steps:
      - name: Checkout
        uses: actions/checkout@v4

      - name: Set up Node
        uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: npm

      - name: Install dependencies
        run: npm ci

      - name: Test
        run: npm run test

      - name: Build
        run: npm run build

      - name: Configure AWS credentials
        uses: aws-actions/configure-aws-credentials@v4
        with:
          role-to-assume: ${{ vars.DEV_AWS_DEPLOY_ROLE_ARN }}
          aws-region: ${{ env.AWS_REGION }}

      - name: Upload immutable assets
        run: >
          aws s3 sync dist/ "s3://${SITE_BUCKET}"
          --delete
          --exclude "index.html"
          --cache-control "public,max-age=31536000,immutable"

      - name: Upload entrypoint
        run: >
          aws s3 cp dist/index.html "s3://${SITE_BUCKET}/index.html"
          --cache-control "no-cache,no-store,must-revalidate"
          --content-type "text/html"

      - name: Invalidate CloudFront
        run: >
          aws cloudfront create-invalidation
          --distribution-id "${CLOUDFRONT_DISTRIBUTION_ID}"
          --paths "/" "/index.html"
```

Notes:

- `dist` is the expected Vite output directory.
- `id-token: write` is required for OIDC.
- No AWS access keys should be stored in GitHub.
- `DEV_AWS_DEPLOY_ROLE_ARN`, `DEV_SITE_BUCKET`, and `DEV_CLOUDFRONT_DISTRIBUTION_ID` can be GitHub environment variables, not secrets.
- If routing or cache behavior is confusing in dev, use `--paths "/*"` for the invalidation first, then optimize later.

## GitHub Repository Configuration

In `halospawns-svelte`, create GitHub Environment:

```text
dev
```

Recommended environment variables:

```text
AWS_REGION=us-east-1
DEV_AWS_DEPLOY_ROLE_ARN=<frontend-site output deploy_role_arn>
DEV_SITE_BUCKET=<frontend-site output site_bucket_name>
DEV_CLOUDFRONT_DISTRIBUTION_ID=<frontend-site output cloudfront_distribution_id>
```

Recommended environment protection:

- Restrict deployments to `main`.
- Add required reviewers only if desired for dev.

If not using GitHub Environments, put these as repository variables and use a branch-scoped IAM trust policy instead.

## Implementation Phases

Progress update as of 2026-05-09:

- Infrastructure code for the dev `frontend-site` component has been implemented and wired into dev workflows.
- The component is now applied in dev and uses `https://dev.halospawns.com` as the site URL.
- The GitHub OIDC trust is configured for `repo:Mintograde/halospawns-svelte:environment:dev`.
- The frontend deploy workflow has been added at `../halospawns-svelte/.github/workflows/deploy-dev.yml`.
- Terraform applies have been run for the initial CloudFront/default-domain bootstrap and the follow-up custom-domain update.
- Validation run:

  ```powershell
  terraform fmt -check -recursive
  terraform -chdir=components/terraform/frontend-site validate
  .\scripts\init.ps1 dev frontend-site
  .\scripts\plan.ps1 dev frontend-site
  .\scripts\plan.ps1 dev
  ```

- `.\scripts\plan.ps1 dev frontend-site` showed `16 to add, 0 to change, 0 to destroy`.
- The full dev plan showed existing components as no-op; only `frontend-site` has expected creates.

DNS delegation update as of 2026-05-09:

- Terraform now includes `modules/delegated-hosted-zone`.
- The dev `frontend-site` stack is configured to create the `dev.halospawns.com` public hosted zone in `halospawns-dev`.
- The CloudFront alias and ACM certificate are enabled; `domain_name` is `dev.halospawns.com` and `create_certificate` is `true`.
- Added `scripts/delegate-dev-zone.ps1` to upsert the `dev.halospawns.com` NS record in the existing, non-Terraform-managed `halospawns-mgmt` parent hosted zone.
- Local validation passed:

  ```powershell
  terraform fmt -check -recursive
  terraform -chdir=components/terraform/frontend-site validate
  ```

- `.\scripts\plan.ps1 dev frontend-site` succeeded and showed `17 to add, 0 to change, 0 to destroy`.
- `.\scripts\plan.ps1 dev` succeeded; existing dev components were no-op and only `frontend-site` had the expected creates.
- `aws iam list-open-id-connect-providers --profile halospawns-dev` returned an empty provider list, so creating the GitHub OIDC provider in dev is expected.
- `aws sts get-caller-identity --profile halospawns-mgmt` confirmed the management account `862739531359`.
- `aws route53 list-hosted-zones-by-name --profile halospawns-mgmt --dns-name halospawns.com --max-items 5` found parent hosted zone `ZW55VB6NEC1QB`.
- Added `scripts/set-frontend-basic-auth-password.ps1` to generate and store a fresh random 12-character alphabetic Basic Auth password in the Terraform-created SSM parameter.

Apply and DNS update as of 2026-05-09:

- Initial `frontend-site` apply completed and created the dev site bucket, CloudFront distribution, Basic Auth Lambda@Edge function, GitHub deploy role, GitHub OIDC provider, and delegated hosted zone.
- `scripts/set-frontend-basic-auth-password.ps1` was run and overwrote `/halospawns/dev/frontend-site/basic-auth/credentials-base64` with a real dev-only Basic Auth value.
- `scripts/delegate-dev-zone.ps1` upserted the parent `NS` delegation record in `halospawns-mgmt`; Route 53 change `C086539826NIDVIBW476Z` reached `INSYNC`.
- `Resolve-DnsName -Type NS dev.halospawns.com` returns the delegated dev hosted zone name servers.
- Follow-up `frontend-site` apply created the `dev.halospawns.com` ACM certificate, DNS validation CNAME, A/AAAA CloudFront alias records, and updated distribution `EVLOWEJDX07PW`.
- `aws cloudfront get-distribution --profile halospawns-dev --id EVLOWEJDX07PW` shows status `Deployed` with alias `dev.halospawns.com`.
- `Resolve-DnsName -Type A dev.halospawns.com` resolves to CloudFront IPs.
- Anonymous `https://dev.halospawns.com/` requests return `401` with `WWW-Authenticate: Basic realm="Halospawns dev"`.
- Authenticated requests currently reach S3 and return `403` because `s3://halospawns-frontend-dev-283279960672/` has no uploaded frontend build yet.
- Post-apply `.\scripts\plan.ps1 dev frontend-site` is clean with no changes.
- Post-apply `.\scripts\plan.ps1 dev` is clean with no changes across all dev components.

DNS delegation run order:

```powershell
.\scripts\plan.ps1 dev frontend-site
.\scripts\apply.ps1 dev frontend-site

.\scripts\delegate-dev-zone.ps1 -WhatIf
.\scripts\delegate-dev-zone.ps1

Resolve-DnsName -Type NS dev.halospawns.com
```

After delegation resolves, enable the custom frontend domain in `stacks/dev.yaml`:

```yaml
domain_name: dev.halospawns.com
create_certificate: true
```

Then re-run:

```powershell
.\scripts\plan.ps1 dev frontend-site
.\scripts\apply.ps1 dev frontend-site
```

### Phase 0: Decisions

- [x] Pick frontend dev domain or decide to start with CloudFront default domain.
- [x] Identify GitHub repo owner for `halospawns-svelte`.
- [x] Decide whether to use GitHub Environment subject (`environment:dev`) or branch subject (`refs/heads/main`) in the IAM trust policy.
- [x] Check whether `token.actions.githubusercontent.com` OIDC provider already exists in the dev AWS account.
- [x] Decide whether `dev.halospawns.com` delegation from `halospawns-mgmt` to `halospawns-dev` is in scope now or deferred.
- [x] Decide whether Route 53/ACM validation is in scope now or deferred.
- [x] If delegating `dev.halospawns.com`, create or identify the dev hosted zone before enabling certificate validation automation.
- [x] Decide the initial dev privacy setting: `basic_auth` is recommended, `public` is allowed for temporary open testing.
- [x] Choose a low-value dev-only Basic Auth username/password if `basic_auth` is enabled.
- [x] Confirm the SSM parameter name for the dev Basic Auth value.

### Phase 0A: Optional DNS Delegation

- [x] If automating delegation, create `modules/delegated-hosted-zone`.
- [x] Create or identify parent hosted zone inputs from `halospawns-mgmt`.
- [x] Create `dev.halospawns.com` public hosted zone in `halospawns-dev`.
- [x] Create NS delegation record for `dev.halospawns.com` in the parent `halospawns.com` zone.
- [x] Output the delegated hosted zone ID for use by `frontend-site`.
- [x] If not automating delegation, document the manual Route 53 steps and keep `frontend-site` on the CloudFront default domain until DNS is ready.

### Phase 1: Static Site Module

- [x] Create `modules/static-site`.
- [x] Add private S3 bucket resources.
- [x] Add CloudFront OAC.
- [x] Add CloudFront distribution.
- [x] Add variable validation for supported access modes.
- [x] Add optional Lambda@Edge viewer-request association only when `access_control_mode = "basic_auth"`.
- [x] Add validation or a precondition requiring `viewer_request_lambda_qualified_arn` in `basic_auth` mode.
- [x] Add S3 bucket policy restricted to the CloudFront distribution.
- [x] Add SPA fallback error responses.
- [x] Add optional aliases/certificate variables.
- [x] Add outputs.
- [x] Run `terraform fmt` and validate through a test component or direct component once wired.

### Phase 1B: Lambda@Edge Basic Auth Module

- [x] Create `modules/lambda-edge-basic-auth`.
- [x] Add optional SSM `SecureString` parameter creation for the Basic Auth value.
- [x] Add `lifecycle.ignore_changes = [value]` on the Basic Auth SSM parameter.
- [x] Add Lambda@Edge execution role with `lambda.amazonaws.com` and `edgelambda.amazonaws.com` trust principals.
- [x] Add least-privilege `ssm:GetParameter` permission on the exact parameter ARN.
- [x] Add optional `kms:Decrypt` permission when `basic_auth_ssm_kms_key_id` is set.
- [x] Add Node.js Lambda code that reads SSM with decryption, caches the credential, and never logs credentials.
- [x] Package dependencies directly in the zip if needed; do not use Lambda layers.
- [x] Publish a numbered Lambda version and output `lambda_function_qualified_arn`.
- [x] Ensure the module uses the `us-east-1` AWS provider because Lambda@Edge functions must be created there.

### Phase 2: GitHub Deploy Role Module

- [x] Create `modules/github-actions-deploy-role`.
- [x] Add optional GitHub OIDC provider creation.
- [x] Add deploy IAM role trust policy.
- [x] Add least-privilege S3/CloudFront policy.
- [x] Add outputs.
- [x] Include a clear import path if the OIDC provider already exists.

### Phase 3: `frontend-site` Component

- [x] Create `components/terraform/frontend-site`.
- [x] Wire `modules/static-site`.
- [x] Wire `modules/lambda-edge-basic-auth`.
- [x] Wire `modules/github-actions-deploy-role`.
- [x] Add component variables and outputs.
- [x] Add `access_control_mode`, `basic_auth_ssm_parameter_name`, `create_basic_auth_ssm_parameter`, `basic_auth_ssm_placeholder_value`, `basic_auth_ssm_kms_key_id`, `create_basic_auth_edge_lambda`, `basic_auth_cache_ttl_seconds`, and `basic_auth_realm` component variables.
- [x] Add validation that `create_basic_auth_edge_lambda` is true when `access_control_mode = "basic_auth"` unless an external Lambda@Edge qualified ARN variable is introduced.
- [x] Add `frontend-site` to `stacks/dev.yaml`.
- [x] Configure backend key `dev/frontend-site/terraform.tfstate`.
- [x] Add `frontend-site` to dev plan/apply workflows.
- [x] Add `frontend-site` to `scripts/init.ps1` component list.
- [x] Run:

  ```powershell
  .\scripts\init.ps1 dev frontend-site
  .\scripts\plan.ps1 dev frontend-site
  ```

- [x] Review planned resources before apply.
- [x] Apply only after review. The first apply should create the SSM parameter with the placeholder value:

  ```powershell
  .\scripts\apply.ps1 dev frontend-site
  ```

- [x] Confirm the SSM parameter exists, then manually overwrite it with the real Base64-encoded `username:password` value.
- [x] Keep `access_control_mode` set to `basic_auth`.
- [x] Re-run plan/apply so CloudFront associates the published Lambda@Edge version and the custom domain.
- [x] Capture outputs:

  ```powershell
  atmos terraform output frontend-site -s dev
  ```

### Phase 4: GitHub Environment Variables

- [ ] Create `dev` environment in `halospawns-svelte`.
- [ ] Add `AWS_REGION`.
- [ ] Add `DEV_AWS_DEPLOY_ROLE_ARN`.
- [ ] Add `DEV_SITE_BUCKET`.
- [ ] Add `DEV_CLOUDFRONT_DISTRIBUTION_ID`.
- [x] If using environment-scoped IAM trust, ensure the workflow job has `environment: dev`.

### Phase 5: Frontend Workflow

- [x] Create `../halospawns-svelte/.github/workflows/deploy-dev.yml`.
- [x] Use `actions/checkout@v4`.
- [x] Use `actions/setup-node@v4`.
- [x] Run `npm ci`.
- [x] Run `npm run test`.
- [x] Run `npm run build`.
- [x] Configure AWS credentials with `aws-actions/configure-aws-credentials@v4`.
- [x] Sync `dist` to S3 with cache headers.
- [x] Upload `index.html` with no-cache headers.
- [x] Create CloudFront invalidation.
- [ ] Trigger manually with `workflow_dispatch` for first deployment.

### Phase 6: Verification

- [ ] Confirm the GitHub workflow assumes the role without static credentials.
- [ ] Confirm S3 objects are uploaded.
- [ ] Confirm CloudFront invalidation succeeds.
- [x] Open the CloudFront default domain or custom domain.
- [x] Confirm the Basic Auth SSM parameter has been overwritten from the placeholder value before relying on `basic_auth` mode.
- [x] If `basic_auth` is enabled, confirm anonymous requests return `401`.
- [ ] If `basic_auth` is enabled, confirm the site loads after entering the username/password.
- [ ] Toggle `access_control_mode` to `public`, apply, and confirm the auth prompt is removed if an open dev window is needed.
- [ ] Toggle `access_control_mode` back to `basic_auth`, apply, and confirm the auth prompt returns.
- [ ] Refresh an app route directly to confirm SPA fallback works.
- [ ] Confirm S3 bucket blocks public access.
- [ ] Confirm bucket policy only allows the CloudFront distribution.
- [x] Run:

  ```powershell
  .\scripts\plan.ps1 dev frontend-site
  .\scripts\plan.ps1 dev
  ```

- [x] Confirm both plans are clean or only contain expected drift.

## Security Checklist

- [ ] No AWS access keys in GitHub secrets.
- [x] GitHub role trust is restricted to `halospawns-svelte`.
- [x] GitHub role trust is restricted to either branch `main` or environment `dev`.
- [x] Deploy role cannot access unrelated buckets.
- [x] Deploy role cannot invalidate unrelated distributions.
- [x] S3 bucket is private and public access is blocked.
- [x] CloudFront uses OAC to access S3.
- [x] Terraform state does not contain GitHub tokens or AWS credentials.
- [x] Real Basic Auth credentials are not committed to this public repository.
- [x] Real Basic Auth value is populated manually in SSM SecureString, not stored in stack YAML.
- [x] Lambda@Edge role can read only the exact Basic Auth SSM parameter.
- [x] If using a customer-managed KMS key, Lambda@Edge role can decrypt only what it needs. Not applicable for dev because the default AWS-managed SSM key is being used.
- [x] Lambda@Edge code does not log `Authorization` headers or the expected credential.
- [ ] The team understands dev Basic Auth is only a light discovery deterrent, not an authorization system.

## Rollback Plan

Frontend deployment rollback:

- Re-run a previous successful GitHub Actions workflow if it is still available.
- Or check out the prior frontend commit and run the deploy workflow manually.

Infrastructure rollback:

- Prefer Terraform changes over manual AWS console edits.
- To disable the frontend temporarily, disable the CloudFront distribution through Terraform.
- Do not destroy the S3 bucket casually; keep `prevent_destroy` or equivalent protection on the site bucket if practical.

## Future Prod Extension

Do not implement prod frontend deployment until prod bootstrap resumes.

When prod is ready:

- Add prod `frontend-site` stack configuration after prod `tfstate-backend` is bootstrapped.
- Use a separate prod S3 bucket and CloudFront distribution.
- Use a temporary prod validation name such as `prod.halospawns.com` before repointing apex or `www`.
- Use a separate GitHub environment named `prod`.
- Use a separate prod deploy role in the prod AWS account.
- Add environment protection and required reviewers for prod deploys.
- Add `deploy-prod.yml` or extend the workflow with environment-specific jobs.
- Plan the final DNS cutover from the existing management-account website to the new prod CloudFront distribution.
- Keep rollback details for the old management-account CloudFront distribution and Route 53 records until the new site is stable.

## Open Questions

- Should `prod.halospawns.com` be delegated later for pre-cutover prod verification?
- Should frontend deployments run on every `main` push, tags, or manual dispatch only?
- Should old hashed assets be deleted immediately with `aws s3 sync --delete`, or retained and cleaned by S3 lifecycle?
- Does the frontend need build-time API environment variables such as `VITE_CURRENT_GAMES_API_URL`?
