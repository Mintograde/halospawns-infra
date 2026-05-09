provider "aws" {
  region  = var.region
  profile = var.profile

  default_tags {
    tags = {
      Project     = var.project
      Environment = var.environment
      "ManagedBy" = "Terraform"
    }
  }
}

provider "aws" {
  alias   = "us_east_1"
  region  = "us-east-1"
  profile = var.profile

  default_tags {
    tags = {
      Project     = var.project
      Environment = var.environment
      "ManagedBy" = "Terraform"
    }
  }
}
