#!/bin/bash
###############################################################################
# MULTI-USER DEPLOYMENT SCRIPT
#
# This script handles the complete deployment process for individual users.
# Each user gets isolated apps and HDI container in a shared CF space.
#
# Usage:
#   ./setup-deployment.sh                # Interactive mode (prompts for values)
#   ./setup-deployment.sh --config       # Generate config files only
#   ./setup-deployment.sh --deploy       # Full deployment (build + deploy)
#   ./setup-deployment.sh --help         # Show help
###############################################################################

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Script directory
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CONFIG_FILE="$SCRIPT_DIR/user-config.json"
MTAEXT_OUTPUT="$SCRIPT_DIR/my-deployment.mtaext"
WEBAPP_CONFIG="$SCRIPT_DIR/app/webapp/config.js"
MTAR_FILE="$SCRIPT_DIR/mta_archives/genai-hana-rag_1.0.0.mtar"

print_header() {
    echo -e "${BLUE}"
    echo "╔══════════════════════════════════════════════════════════════════╗"
    echo "║          SAP CAP RAG - Multi-User Deployment                     ║"
    echo "╚══════════════════════════════════════════════════════════════════╝"
    echo -e "${NC}"
}

print_help() {
    print_header
    echo "Usage: $0 [OPTIONS]"
    echo ""
    echo "Options:"
    echo "  --config       Generate configuration files only (no deployment)"
    echo "  --deploy       Full deployment: build and deploy"
    echo "  --interactive  (default) Prompt for configuration values"
    echo "  --help         Show this help message"
    echo ""
    echo "Examples:"
    echo "  $0                    # Interactive mode - prompts for values"
    echo "  $0 --config           # Generate files from user-config.json"
    echo "  $0 --deploy           # Full automated deployment"
    echo ""
    echo "Naming Convention:"
    echo "  Apps:          {USERNAME}-genai-hana-rag-srv, -app, -db-deployer"
    echo "  HDI Container: {USERNAME}-hana-hdi-rag"
    echo "  AI Backend:    genai-proxy-secure (via env vars, no CF service binding)"
}

validate_username() {
    local username=$1
    if [[ ! $username =~ ^[a-z0-9][a-z0-9-]*[a-z0-9]$ ]] && [[ ! $username =~ ^[a-z0-9]$ ]]; then
        echo -e "${RED}Error: Username must be lowercase alphanumeric with optional hyphens${NC}"
        echo "Valid examples: jsmith, john-doe, user1, tac007581u01"
        return 1
    fi
    return 0
}

validate_region() {
    local region=$1
    local valid_regions=("eu10" "eu20" "eu30" "us10" "us20" "us21" "ap10" "ap11" "ap12" "ap20" "ap21" "br10" "ca10" "jp10" "jp20")
    for valid in "${valid_regions[@]}"; do
        if [[ "$region" == "$valid" ]] || [[ "$region" == "$valid-"* ]]; then
            return 0
        fi
    done
    echo -e "${YELLOW}Warning: '$region' is not a standard region. Proceeding anyway.${NC}"
    return 0
}

validate_uuid() {
    local uuid=$1
    if [[ ! $uuid =~ ^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$ ]]; then
        echo -e "${RED}Error: Database ID must be a valid UUID format${NC}"
        echo "Example: 1159f744-6592-4c54-a96e-a6a924da3fbb"
        return 1
    fi
    return 0
}

read_from_config() {
    if [[ ! -f "$CONFIG_FILE" ]]; then
        echo -e "${RED}Error: Configuration file not found: $CONFIG_FILE${NC}"
        echo "Please create user-config.json or run in interactive mode."
        exit 1
    fi

    # Check if jq is available, otherwise use grep/sed
    if command -v jq &> /dev/null; then
        USERNAME=$(jq -r '.USERNAME' "$CONFIG_FILE")
        REGION=$(jq -r '.REGION' "$CONFIG_FILE")
        DATABASE_ID=$(jq -r '.DATABASE_ID' "$CONFIG_FILE")
        PROXY_BASE_URL=$(jq -r '.PROXY_BASE_URL' "$CONFIG_FILE")
        PROXY_API_KEY=$(jq -r '.PROXY_API_KEY' "$CONFIG_FILE")
        CHAT_MODEL=$(jq -r '.CHAT_MODEL' "$CONFIG_FILE")
        EMBEDDING_MODEL=$(jq -r '.EMBEDDING_MODEL' "$CONFIG_FILE")
    else
        # Fallback to grep/sed parsing
        USERNAME=$(grep '"USERNAME"' "$CONFIG_FILE" | head -1 | sed 's/.*: *"\([^"]*\)".*/\1/')
        REGION=$(grep '"REGION"' "$CONFIG_FILE" | head -1 | sed 's/.*: *"\([^"]*\)".*/\1/')
        DATABASE_ID=$(grep '"DATABASE_ID"' "$CONFIG_FILE" | head -1 | sed 's/.*: *"\([^"]*\)".*/\1/')
        PROXY_BASE_URL=$(grep '"PROXY_BASE_URL"' "$CONFIG_FILE" | head -1 | sed 's/.*: *"\([^"]*\)".*/\1/')
        PROXY_API_KEY=$(grep '"PROXY_API_KEY"' "$CONFIG_FILE" | head -1 | sed 's/.*: *"\([^"]*\)".*/\1/')
        CHAT_MODEL=$(grep '"CHAT_MODEL"' "$CONFIG_FILE" | head -1 | sed 's/.*: *"\([^"]*\)".*/\1/')
        EMBEDDING_MODEL=$(grep '"EMBEDDING_MODEL"' "$CONFIG_FILE" | head -1 | sed 's/.*: *"\([^"]*\)".*/\1/')
    fi

    # Convert USERNAME to lowercase for CF naming conventions
    USERNAME=$(echo "$USERNAME" | tr '[:upper:]' '[:lower:]')

    # Validate that values were replaced from defaults
    if [[ "$USERNAME" == "your-username" ]] || [[ -z "$USERNAME" ]]; then
        echo -e "${RED}Error: Please update USERNAME in user-config.json${NC}"
        exit 1
    fi
    if [[ "$DATABASE_ID" == "your-hana-database-id" ]] || [[ -z "$DATABASE_ID" ]]; then
        echo -e "${RED}Error: Please update DATABASE_ID in user-config.json${NC}"
        exit 1
    fi
    if [[ -z "$PROXY_API_KEY" ]] || [[ "$PROXY_API_KEY" == "null" ]] || [[ "$PROXY_API_KEY" == "your-proxy-api-key" ]]; then
        echo -e "${RED}Error: Please update PROXY_API_KEY in user-config.json${NC}"
        exit 1
    fi
    if [[ -z "$PROXY_BASE_URL" ]] || [[ "$PROXY_BASE_URL" == "null" ]]; then
        echo -e "${RED}Error: Please update PROXY_BASE_URL in user-config.json${NC}"
        exit 1
    fi
    # Default models if not set
    CHAT_MODEL=${CHAT_MODEL:-gpt-4o}
    EMBEDDING_MODEL=${EMBEDDING_MODEL:-text-embedding-3-large}
}

interactive_mode() {
    echo -e "${YELLOW}Interactive Configuration Mode${NC}"
    echo "Please provide the following information:"
    echo ""

    # Username
    while true; do
        read -p "Enter your username (lowercase, e.g., tac007581u01): " USERNAME
        # Convert to lowercase
        USERNAME=$(echo "$USERNAME" | tr '[:upper:]' '[:lower:]')
        if validate_username "$USERNAME"; then
            break
        fi
    done

    # Region
    echo ""
    echo "Common regions: eu10, eu10-004, us10, us20, ap10, ap20"
    read -p "Enter your CF region (e.g., eu10-004): " REGION
    validate_region "$REGION"

    # Database ID
    echo ""
    echo "Find your Database ID in BTP Cockpit > HANA Cloud > Manage Configuration"
    while true; do
        read -p "Enter your HANA Database ID (UUID format): " DATABASE_ID
        if validate_uuid "$DATABASE_ID"; then
            break
        fi
    done

    # Proxy configuration
    echo ""
    echo "genai-proxy-secure configuration"
    echo "Get your API key from the proxy Admin UI (ask your proxy admin)"
    read -p "Enter your Proxy Base URL [https://genai-proxy-secure.cfapps.eu10-004.hana.ondemand.com/v1]: " PROXY_BASE_URL
    PROXY_BASE_URL=${PROXY_BASE_URL:-https://genai-proxy-secure.cfapps.eu10-004.hana.ondemand.com/v1}

    read -p "Enter your Proxy API Key: " PROXY_API_KEY
    if [[ -z "$PROXY_API_KEY" ]]; then
        echo -e "${RED}Error: Proxy API key cannot be empty${NC}"
        exit 1
    fi

    echo ""
    read -p "Chat model name [gpt-4o]: " CHAT_MODEL
    CHAT_MODEL=${CHAT_MODEL:-gpt-4o}

    read -p "Embedding model name [text-embedding-3-large]: " EMBEDDING_MODEL
    EMBEDDING_MODEL=${EMBEDDING_MODEL:-text-embedding-3-large}

    # Save to config file
    echo ""
    read -p "Save configuration to user-config.json? (y/n): " SAVE_CONFIG
    if [[ "$SAVE_CONFIG" =~ ^[Yy]$ ]]; then
        save_config
        echo -e "${GREEN}Configuration saved to user-config.json${NC}"
    fi
}

save_config() {
    cat > "$CONFIG_FILE" << EOF
{
  "// INSTRUCTIONS": "Edit values below, then run: ./setup-deployment.sh --deploy",

  "USERNAME": "$USERNAME",
  "REGION": "$REGION",
  "DATABASE_ID": "$DATABASE_ID",
  "PROXY_BASE_URL": "$PROXY_BASE_URL",
  "PROXY_API_KEY": "$PROXY_API_KEY",
  "CHAT_MODEL": "$CHAT_MODEL",
  "EMBEDDING_MODEL": "$EMBEDDING_MODEL",

  "// NAMING_CONVENTION": {
    "CF_APP_SERVICE": "${USERNAME}-genai-hana-rag-srv",
    "CF_APP_WEBAPP": "${USERNAME}-genai-hana-rag-app",
    "CF_APP_DEPLOYER": "${USERNAME}-genai-hana-rag-db-deployer",
    "HDI_CONTAINER": "${USERNAME}-hana-hdi-rag",
    "SERVICE_URL": "https://${USERNAME}-genai-hana-rag-srv.cfapps.${REGION}.hana.ondemand.com",
    "APP_URL": "https://${USERNAME}-genai-hana-rag-app.cfapps.${REGION}.hana.ondemand.com"
  }
}
EOF
}

generate_mtaext() {
    echo -e "${BLUE}Generating MTA extension file...${NC}"

    cat > "$MTAEXT_OUTPUT" << EOF
###############################################################################
# AUTO-GENERATED MTA Extension File
# Generated for: $USERNAME
# Generated on: $(date)
#
# Deploy command:
#   cf deploy mta_archives/genai-hana-rag_1.0.0.mtar -e my-deployment.mtaext --namespace ${USERNAME}
#
# Resources created:
#   - ${USERNAME}-genai-hana-rag-srv
#   - ${USERNAME}-genai-hana-rag-app
#   - ${USERNAME}-genai-hana-rag-db-deployer
#   - ${USERNAME}-hana-hdi-rag (HDI container)
#
# Undeploy command:
#   cf undeploy genai-hana-rag --namespace ${USERNAME} --delete-services --delete-service-keys
###############################################################################

_schema-version: "3.1"
ID: genai-hana-rag
extends: genai-hana-rag

modules:
  # Service module - custom route + proxy env vars
  - name: genai-hana-rag-srv
    parameters:
      routes:
        - route: ${USERNAME}-genai-hana-rag-srv.cfapps.${REGION}.hana.ondemand.com
    properties:
      PROXY_BASE_URL: ${PROXY_BASE_URL}
      PROXY_API_KEY: ${PROXY_API_KEY}
      CHAT_MODEL: ${CHAT_MODEL}
      EMBEDDING_MODEL: ${EMBEDDING_MODEL}

  # Web app module - custom route
  - name: genai-hana-rag-app
    parameters:
      routes:
        - route: ${USERNAME}-genai-hana-rag-app.cfapps.${REGION}.hana.ondemand.com

resources:
  # HDI container - namespaced to ${USERNAME}-hana-hdi-rag
  - name: hana-hdi-rag
    parameters:
      config:
        database_id: ${DATABASE_ID}
EOF

    echo -e "${GREEN}Created: $MTAEXT_OUTPUT${NC}"
}

update_webapp_config() {
    echo -e "${BLUE}Updating webapp configuration...${NC}"

    local SRV_URL="https://${USERNAME}-genai-hana-rag-srv.cfapps.${REGION}.hana.ondemand.com"

    cat > "$WEBAPP_CONFIG" << EOF
window.RAG_CONFIG = {
    // API base URL - points to the srv app
    // Auto-generated for user: $USERNAME
    // Generated on: $(date)
    apiBaseUrl: "${SRV_URL}"
};
EOF

    echo -e "${GREEN}Updated: $WEBAPP_CONFIG${NC}"
}

build_app() {
    echo ""
    echo -e "${BLUE}Building application...${NC}"
    cd "$SCRIPT_DIR"
    mbt build
    echo -e "${GREEN}Build complete: $MTAR_FILE${NC}"
}

deploy_app() {
    echo ""
    echo -e "${BLUE}Deploying application with namespace '${USERNAME}'...${NC}"
    cf deploy "$MTAR_FILE" -e "$MTAEXT_OUTPUT" --namespace "$USERNAME"
    echo -e "${GREEN}Deployment complete${NC}"
}

print_summary() {
    echo ""
    echo -e "${GREEN}╔══════════════════════════════════════════════════════════════════╗${NC}"
    echo -e "${GREEN}║                    Configuration Complete!                       ║${NC}"
    echo -e "${GREEN}╚══════════════════════════════════════════════════════════════════╝${NC}"
    echo ""
    echo -e "${YELLOW}Your Configuration:${NC}"
    echo "  Username/Namespace:  $USERNAME"
    echo "  Region:              $REGION"
    echo "  Database ID:         $DATABASE_ID"
    echo "  Proxy URL:           $PROXY_BASE_URL"
    echo "  Chat Model:          $CHAT_MODEL"
    echo "  Embedding Model:     $EMBEDDING_MODEL"
    echo ""
    echo -e "${YELLOW}CF Application Names:${NC}"
    echo "  Service App:         ${USERNAME}-genai-hana-rag-srv"
    echo "  Web App:             ${USERNAME}-genai-hana-rag-app"
    echo "  DB Deployer:         ${USERNAME}-genai-hana-rag-db-deployer"
    echo ""
    echo -e "${YELLOW}Service Instances:${NC}"
    echo "  HDI Container:       ${USERNAME}-hana-hdi-rag"
    echo "  AI Backend:          genai-proxy-secure (env vars, no CF binding needed)"
    echo ""
    echo -e "${YELLOW}URLs:${NC}"
    echo "  App URL:             https://${USERNAME}-genai-hana-rag-app.cfapps.${REGION}.hana.ondemand.com"
    echo "  Service URL:         https://${USERNAME}-genai-hana-rag-srv.cfapps.${REGION}.hana.ondemand.com"
    echo ""
}

print_next_steps() {
    echo -e "${YELLOW}Next Steps:${NC}"
    echo "  1. Ensure you are logged into Cloud Foundry:"
    echo -e "     ${BLUE}cf login -a https://api.cf.${REGION}.hana.ondemand.com${NC}"
    echo ""
    echo "  2. Run full deployment:"
    echo -e "     ${BLUE}./setup-deployment.sh --deploy${NC}"
    echo ""
    echo "  Or deploy manually:"
    echo -e "     ${BLUE}mbt build${NC}"
    echo -e "     ${BLUE}cf deploy mta_archives/genai-hana-rag_1.0.0.mtar -e my-deployment.mtaext --namespace ${USERNAME}${NC}"
    echo ""
    echo -e "${YELLOW}To undeploy:${NC}"
    echo -e "     ${BLUE}cf undeploy genai-hana-rag --namespace ${USERNAME} --delete-services --delete-service-keys${NC}"
    echo ""
}

print_deploy_complete() {
    echo ""
    echo -e "${GREEN}╔══════════════════════════════════════════════════════════════════╗${NC}"
    echo -e "${GREEN}║                    Deployment Complete!                          ║${NC}"
    echo -e "${GREEN}╚══════════════════════════════════════════════════════════════════╝${NC}"
    echo ""
    echo -e "${YELLOW}Your Application URLs:${NC}"
    echo -e "  App:     ${GREEN}https://${USERNAME}-genai-hana-rag-app.cfapps.${REGION}.hana.ondemand.com${NC}"
    echo -e "  API:     ${GREEN}https://${USERNAME}-genai-hana-rag-srv.cfapps.${REGION}.hana.ondemand.com${NC}"
    echo ""
    echo -e "${YELLOW}AI calls are routed through:${NC}"
    echo -e "  ${BLUE}${PROXY_BASE_URL}${NC}"
    echo ""
    echo -e "${YELLOW}To undeploy:${NC}"
    echo -e "  ${BLUE}cf undeploy genai-hana-rag --namespace ${USERNAME} --delete-services --delete-service-keys${NC}"
    echo ""
}

# Main execution
main() {
    print_header

    local MODE="interactive"
    local DO_DEPLOY=false

    # Parse arguments
    case "${1:-}" in
        --help|-h)
            print_help
            exit 0
            ;;
        --config|-c)
            MODE="config"
            ;;
        --deploy|-d)
            MODE="config"
            DO_DEPLOY=true
            ;;
        *)
            MODE="interactive"
            ;;
    esac

    # Get configuration
    if [[ "$MODE" == "config" ]]; then
        echo -e "${YELLOW}Reading from user-config.json...${NC}"
        read_from_config
    else
        interactive_mode
    fi

    # Validate inputs
    echo ""
    echo -e "${BLUE}Validating configuration...${NC}"
    validate_username "$USERNAME" || exit 1
    validate_region "$REGION"
    validate_uuid "$DATABASE_ID" || exit 1

    if [[ -z "$PROXY_API_KEY" ]]; then
        echo -e "${RED}Error: Proxy API key cannot be empty${NC}"
        exit 1
    fi

    if [[ -z "$PROXY_BASE_URL" ]]; then
        echo -e "${RED}Error: Proxy base URL cannot be empty${NC}"
        exit 1
    fi

    # Generate files
    generate_mtaext
    update_webapp_config
    print_summary

    # Deploy if requested
    if [[ "$DO_DEPLOY" == true ]]; then
        build_app
        deploy_app
        print_deploy_complete
    else
        print_next_steps
    fi
}

main "$@"
