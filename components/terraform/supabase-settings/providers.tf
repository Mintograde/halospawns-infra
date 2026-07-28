terraform {
  required_version = ">= 1.5.0"

  required_providers {
    supabase = {
      source  = "supabase/supabase"
      version = "~> 1.9.1"
    }
  }
}

provider "supabase" {
  # Read from SUPABASE_ACCESS_TOKEN.
}
