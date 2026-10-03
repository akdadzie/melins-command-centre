export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      accounts: {
        Row: {
          admin_may_post: boolean
          company_id: string
          created_at: string
          currency: string
          id: string
          institution: string | null
          is_active: boolean
          last4: string | null
          name: string
          notes: string | null
          opening_balance: number
          opening_date: string
          purpose: string
          type: string
          updated_at: string
        }
        Insert: {
          admin_may_post?: boolean
          company_id?: string
          created_at?: string
          currency?: string
          id?: string
          institution?: string | null
          is_active?: boolean
          last4?: string | null
          name: string
          notes?: string | null
          opening_balance?: number
          opening_date: string
          purpose: string
          type: string
          updated_at?: string
        }
        Update: {
          admin_may_post?: boolean
          company_id?: string
          created_at?: string
          currency?: string
          id?: string
          institution?: string | null
          is_active?: boolean
          last4?: string | null
          name?: string
          notes?: string | null
          opening_balance?: number
          opening_date?: string
          purpose?: string
          type?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "accounts_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      action_items: {
        Row: {
          assigned_role: Database["public"]["Enums"]["app_role"] | null
          assigned_to: string | null
          created_at: string
          created_by: string | null
          done_at: string | null
          done_by: string | null
          due_date: string | null
          id: string
          kind: string
          link: string
          record_id: string | null
          record_type: string | null
          status: string
          title: string
        }
        Insert: {
          assigned_role?: Database["public"]["Enums"]["app_role"] | null
          assigned_to?: string | null
          created_at?: string
          created_by?: string | null
          done_at?: string | null
          done_by?: string | null
          due_date?: string | null
          id?: string
          kind: string
          link: string
          record_id?: string | null
          record_type?: string | null
          status?: string
          title: string
        }
        Update: {
          assigned_role?: Database["public"]["Enums"]["app_role"] | null
          assigned_to?: string | null
          created_at?: string
          created_by?: string | null
          done_at?: string | null
          done_by?: string | null
          due_date?: string | null
          id?: string
          kind?: string
          link?: string
          record_id?: string | null
          record_type?: string | null
          status?: string
          title?: string
        }
        Relationships: [
          {
            foreignKeyName: "action_items_assigned_to_fkey"
            columns: ["assigned_to"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "action_items_assigned_to_fkey"
            columns: ["assigned_to"]
            isOneToOne: false
            referencedRelation: "user_directory"
            referencedColumns: ["user_id"]
          },
        ]
      }
      audit_log: {
        Row: {
          action: string
          changed_at: string
          changed_by: string | null
          id: number
          new_data: Json | null
          old_data: Json | null
          record_id: string | null
          table_name: string
        }
        Insert: {
          action: string
          changed_at?: string
          changed_by?: string | null
          id?: never
          new_data?: Json | null
          old_data?: Json | null
          record_id?: string | null
          table_name: string
        }
        Update: {
          action?: string
          changed_at?: string
          changed_by?: string | null
          id?: never
          new_data?: Json | null
          old_data?: Json | null
          record_id?: string | null
          table_name?: string
        }
        Relationships: []
      }
      billing_milestones: {
        Row: {
          amount: number | null
          created_at: string
          id: string
          invoice_id: string | null
          job_id: string
          name: string
          notes: string | null
          percent_of_fee: number | null
          reached_by: string | null
          reached_on: string | null
          seq: number
          status: string
          target_date: string | null
          trigger_description: string | null
          updated_at: string
        }
        Insert: {
          amount?: number | null
          created_at?: string
          id?: string
          invoice_id?: string | null
          job_id: string
          name: string
          notes?: string | null
          percent_of_fee?: number | null
          reached_by?: string | null
          reached_on?: string | null
          seq?: number
          status?: string
          target_date?: string | null
          trigger_description?: string | null
          updated_at?: string
        }
        Update: {
          amount?: number | null
          created_at?: string
          id?: string
          invoice_id?: string | null
          job_id?: string
          name?: string
          notes?: string | null
          percent_of_fee?: number | null
          reached_by?: string | null
          reached_on?: string | null
          seq?: number
          status?: string
          target_date?: string | null
          trigger_description?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "billing_milestones_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "job_hours_vs_budget"
            referencedColumns: ["job_id"]
          },
          {
            foreignKeyName: "billing_milestones_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "job_milestone_check"
            referencedColumns: ["job_id"]
          },
          {
            foreignKeyName: "billing_milestones_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "job_money_status"
            referencedColumns: ["job_id"]
          },
          {
            foreignKeyName: "billing_milestones_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "jobs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "billing_milestones_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "jobs_flagged"
            referencedColumns: ["job_id"]
          },
          {
            foreignKeyName: "billing_milestones_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "my_jobs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "billing_milestones_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "retention_by_job"
            referencedColumns: ["job_id"]
          },
          {
            foreignKeyName: "billing_milestones_reached_by_fkey"
            columns: ["reached_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "billing_milestones_reached_by_fkey"
            columns: ["reached_by"]
            isOneToOne: false
            referencedRelation: "user_directory"
            referencedColumns: ["user_id"]
          },
        ]
      }
      budget_roles: {
        Row: {
          billable_default: boolean
          id: string
          name: string
          sort_order: number
        }
        Insert: {
          billable_default?: boolean
          id?: string
          name: string
          sort_order?: number
        }
        Update: {
          billable_default?: boolean
          id?: string
          name?: string
          sort_order?: number
        }
        Relationships: []
      }
      clients: {
        Row: {
          address: string | null
          company_id: string
          contact_person: string | null
          created_at: string
          created_by: string | null
          deducts_wht: boolean
          email: string | null
          id: string
          is_active: boolean
          is_vat_withholding_agent: boolean
          name: string
          notes: string | null
          organisation: string | null
          payment_terms_days: number | null
          phone: string | null
          tin: string | null
          type: string
          updated_at: string
          vat_number: string | null
          wht_category: string | null
        }
        Insert: {
          address?: string | null
          company_id?: string
          contact_person?: string | null
          created_at?: string
          created_by?: string | null
          deducts_wht?: boolean
          email?: string | null
          id?: string
          is_active?: boolean
          is_vat_withholding_agent?: boolean
          name: string
          notes?: string | null
          organisation?: string | null
          payment_terms_days?: number | null
          phone?: string | null
          tin?: string | null
          type?: string
          updated_at?: string
          vat_number?: string | null
          wht_category?: string | null
        }
        Update: {
          address?: string | null
          company_id?: string
          contact_person?: string | null
          created_at?: string
          created_by?: string | null
          deducts_wht?: boolean
          email?: string | null
          id?: string
          is_active?: boolean
          is_vat_withholding_agent?: boolean
          name?: string
          notes?: string | null
          organisation?: string | null
          payment_terms_days?: number | null
          phone?: string | null
          tin?: string | null
          type?: string
          updated_at?: string
          vat_number?: string | null
          wht_category?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "clients_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      companies: {
        Row: {
          created_at: string
          id: string
          name: string
        }
        Insert: {
          created_at?: string
          id: string
          name: string
        }
        Update: {
          created_at?: string
          id?: string
          name?: string
        }
        Relationships: []
      }
      credit_note_taxes: {
        Row: {
          amount: number
          credit_note_id: string
          is_vat: boolean
          name: string
          rate: number
          recoverable: boolean
          seq: number
        }
        Insert: {
          amount: number
          credit_note_id: string
          is_vat: boolean
          name: string
          rate: number
          recoverable: boolean
          seq: number
        }
        Update: {
          amount?: number
          credit_note_id?: string
          is_vat?: boolean
          name?: string
          rate?: number
          recoverable?: boolean
          seq?: number
        }
        Relationships: [
          {
            foreignKeyName: "credit_note_taxes_credit_note_id_fkey"
            columns: ["credit_note_id"]
            isOneToOne: false
            referencedRelation: "credit_notes"
            referencedColumns: ["id"]
          },
        ]
      }
      credit_notes: {
        Row: {
          approved_at: string | null
          approved_by: string | null
          cn_date: string
          cn_number: string | null
          company_id: string
          created_at: string
          created_by: string | null
          currency: string
          draft_ref: string
          fx_rate: number
          gross_amount: number
          id: string
          invoice_id: string
          net_amount: number
          reason: string
          status: string
          tax_amount: number
          tax_code_id: string | null
          updated_at: string
        }
        Insert: {
          approved_at?: string | null
          approved_by?: string | null
          cn_date?: string
          cn_number?: string | null
          company_id?: string
          created_at?: string
          created_by?: string | null
          currency?: string
          draft_ref?: string
          fx_rate?: number
          gross_amount?: number
          id?: string
          invoice_id: string
          net_amount: number
          reason: string
          status?: string
          tax_amount?: number
          tax_code_id?: string | null
          updated_at?: string
        }
        Update: {
          approved_at?: string | null
          approved_by?: string | null
          cn_date?: string
          cn_number?: string | null
          company_id?: string
          created_at?: string
          created_by?: string | null
          currency?: string
          draft_ref?: string
          fx_rate?: number
          gross_amount?: number
          id?: string
          invoice_id?: string
          net_amount?: number
          reason?: string
          status?: string
          tax_amount?: number
          tax_code_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "credit_notes_approved_by_fkey"
            columns: ["approved_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "credit_notes_approved_by_fkey"
            columns: ["approved_by"]
            isOneToOne: false
            referencedRelation: "user_directory"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "credit_notes_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "credit_notes_invoice_id_fkey"
            columns: ["invoice_id"]
            isOneToOne: false
            referencedRelation: "invoices"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "credit_notes_invoice_id_fkey"
            columns: ["invoice_id"]
            isOneToOne: false
            referencedRelation: "invoices_to_chase"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "credit_notes_invoice_id_fkey"
            columns: ["invoice_id"]
            isOneToOne: false
            referencedRelation: "receivables_ageing"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "credit_notes_tax_code_id_fkey"
            columns: ["tax_code_id"]
            isOneToOne: false
            referencedRelation: "tax_codes"
            referencedColumns: ["id"]
          },
        ]
      }
      director_hidden_areas: {
        Row: {
          area: string
          hidden: boolean
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          area: string
          hidden?: boolean
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          area?: string
          hidden?: boolean
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: []
      }
      director_payments: {
        Row: {
          account_id: string | null
          approved_at: string | null
          approved_by: string | null
          attachment_path: string | null
          board_resolution_path: string | null
          category_id: string | null
          company_id: string
          created_at: string
          created_by: string | null
          currency: string
          director_id: string
          fx_rate: number
          gross_amount: number
          id: string
          is_to_owner: boolean
          method: string | null
          net_amount: number
          notes: string | null
          paid_at: string | null
          paid_by: string | null
          payment_date: string | null
          payment_type: string
          prepared_by: string | null
          query_note: string | null
          reference: string | null
          review_status: Database["public"]["Enums"]["review_status"]
          reviewed_at: string | null
          reviewed_by: string | null
          status: Database["public"]["Enums"]["payout_status"]
          tax_amount: number
          tax_rate: number
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          account_id?: string | null
          approved_at?: string | null
          approved_by?: string | null
          attachment_path?: string | null
          board_resolution_path?: string | null
          category_id?: string | null
          company_id?: string
          created_at?: string
          created_by?: string | null
          currency?: string
          director_id: string
          fx_rate?: number
          gross_amount: number
          id?: string
          is_to_owner?: boolean
          method?: string | null
          net_amount?: number
          notes?: string | null
          paid_at?: string | null
          paid_by?: string | null
          payment_date?: string | null
          payment_type: string
          prepared_by?: string | null
          query_note?: string | null
          reference?: string | null
          review_status?: Database["public"]["Enums"]["review_status"]
          reviewed_at?: string | null
          reviewed_by?: string | null
          status?: Database["public"]["Enums"]["payout_status"]
          tax_amount?: number
          tax_rate?: number
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          account_id?: string | null
          approved_at?: string | null
          approved_by?: string | null
          attachment_path?: string | null
          board_resolution_path?: string | null
          category_id?: string | null
          company_id?: string
          created_at?: string
          created_by?: string | null
          currency?: string
          director_id?: string
          fx_rate?: number
          gross_amount?: number
          id?: string
          is_to_owner?: boolean
          method?: string | null
          net_amount?: number
          notes?: string | null
          paid_at?: string | null
          paid_by?: string | null
          payment_date?: string | null
          payment_type?: string
          prepared_by?: string | null
          query_note?: string | null
          reference?: string | null
          review_status?: Database["public"]["Enums"]["review_status"]
          reviewed_at?: string | null
          reviewed_by?: string | null
          status?: Database["public"]["Enums"]["payout_status"]
          tax_amount?: number
          tax_rate?: number
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "director_payments_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "account_balances"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "director_payments_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "account_picker"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "director_payments_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "director_payments_approved_by_fkey"
            columns: ["approved_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "director_payments_approved_by_fkey"
            columns: ["approved_by"]
            isOneToOne: false
            referencedRelation: "user_directory"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "director_payments_category_id_fkey"
            columns: ["category_id"]
            isOneToOne: false
            referencedRelation: "expense_categories"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "director_payments_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "director_payments_director_id_fkey"
            columns: ["director_id"]
            isOneToOne: false
            referencedRelation: "director_balances"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "director_payments_director_id_fkey"
            columns: ["director_id"]
            isOneToOne: false
            referencedRelation: "directors"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "director_payments_director_id_fkey"
            columns: ["director_id"]
            isOneToOne: false
            referencedRelation: "user_directory"
            referencedColumns: ["director_id"]
          },
          {
            foreignKeyName: "director_payments_paid_by_fkey"
            columns: ["paid_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "director_payments_paid_by_fkey"
            columns: ["paid_by"]
            isOneToOne: false
            referencedRelation: "user_directory"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "director_payments_prepared_by_fkey"
            columns: ["prepared_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "director_payments_prepared_by_fkey"
            columns: ["prepared_by"]
            isOneToOne: false
            referencedRelation: "user_directory"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "director_payments_reviewed_by_fkey"
            columns: ["reviewed_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "director_payments_reviewed_by_fkey"
            columns: ["reviewed_by"]
            isOneToOne: false
            referencedRelation: "user_directory"
            referencedColumns: ["user_id"]
          },
        ]
      }
      director_transactions: {
        Row: {
          account_id: string
          amount: number
          attachment_path: string | null
          company_id: string
          created_at: string
          created_by: string | null
          currency: string
          description: string | null
          director_id: string
          fx_rate: number
          id: string
          query_note: string | null
          reference: string | null
          review_status: Database["public"]["Enums"]["review_status"]
          reviewed_at: string | null
          reviewed_by: string | null
          txn_date: string
          type: string
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          account_id: string
          amount: number
          attachment_path?: string | null
          company_id?: string
          created_at?: string
          created_by?: string | null
          currency?: string
          description?: string | null
          director_id: string
          fx_rate?: number
          id?: string
          query_note?: string | null
          reference?: string | null
          review_status?: Database["public"]["Enums"]["review_status"]
          reviewed_at?: string | null
          reviewed_by?: string | null
          txn_date: string
          type: string
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          account_id?: string
          amount?: number
          attachment_path?: string | null
          company_id?: string
          created_at?: string
          created_by?: string | null
          currency?: string
          description?: string | null
          director_id?: string
          fx_rate?: number
          id?: string
          query_note?: string | null
          reference?: string | null
          review_status?: Database["public"]["Enums"]["review_status"]
          reviewed_at?: string | null
          reviewed_by?: string | null
          txn_date?: string
          type?: string
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "director_transactions_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "account_balances"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "director_transactions_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "account_picker"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "director_transactions_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "director_transactions_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "director_transactions_director_id_fkey"
            columns: ["director_id"]
            isOneToOne: false
            referencedRelation: "director_balances"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "director_transactions_director_id_fkey"
            columns: ["director_id"]
            isOneToOne: false
            referencedRelation: "directors"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "director_transactions_director_id_fkey"
            columns: ["director_id"]
            isOneToOne: false
            referencedRelation: "user_directory"
            referencedColumns: ["director_id"]
          },
          {
            foreignKeyName: "director_transactions_reviewed_by_fkey"
            columns: ["reviewed_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "director_transactions_reviewed_by_fkey"
            columns: ["reviewed_by"]
            isOneToOne: false
            referencedRelation: "user_directory"
            referencedColumns: ["user_id"]
          },
        ]
      }
      directors: {
        Row: {
          created_at: string
          full_name: string
          id: string
          is_active: boolean
          is_owner: boolean
          profile_id: string | null
        }
        Insert: {
          created_at?: string
          full_name: string
          id?: string
          is_active?: boolean
          is_owner?: boolean
          profile_id?: string | null
        }
        Update: {
          created_at?: string
          full_name?: string
          id?: string
          is_active?: boolean
          is_owner?: boolean
          profile_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "directors_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: true
            referencedRelation: "profiles"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "directors_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: true
            referencedRelation: "user_directory"
            referencedColumns: ["user_id"]
          },
        ]
      }
      expense_categories: {
        Row: {
          created_at: string
          id: string
          is_active: boolean
          name: string
          parent_id: string | null
          requires_job: boolean
          sort_order: number
        }
        Insert: {
          created_at?: string
          id?: string
          is_active?: boolean
          name: string
          parent_id?: string | null
          requires_job?: boolean
          sort_order?: number
        }
        Update: {
          created_at?: string
          id?: string
          is_active?: boolean
          name?: string
          parent_id?: string | null
          requires_job?: boolean
          sort_order?: number
        }
        Relationships: [
          {
            foreignKeyName: "expense_categories_parent_id_fkey"
            columns: ["parent_id"]
            isOneToOne: false
            referencedRelation: "expense_categories"
            referencedColumns: ["id"]
          },
        ]
      }
      expense_taxes: {
        Row: {
          amount: number
          expense_id: string
          is_vat: boolean
          name: string
          rate: number
          recoverable: boolean
          seq: number
        }
        Insert: {
          amount: number
          expense_id: string
          is_vat: boolean
          name: string
          rate: number
          recoverable: boolean
          seq: number
        }
        Update: {
          amount?: number
          expense_id?: string
          is_vat?: boolean
          name?: string
          rate?: number
          recoverable?: boolean
          seq?: number
        }
        Relationships: [
          {
            foreignKeyName: "expense_taxes_expense_id_fkey"
            columns: ["expense_id"]
            isOneToOne: false
            referencedRelation: "expenses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "expense_taxes_expense_id_fkey"
            columns: ["expense_id"]
            isOneToOne: false
            referencedRelation: "supplier_bills_open"
            referencedColumns: ["id"]
          },
        ]
      }
      expenses: {
        Row: {
          account_id: string | null
          amount: number
          category_id: string
          claim_decided_at: string | null
          claim_decided_by: string | null
          claim_note: string | null
          company_id: string
          created_at: string
          created_by: string | null
          currency: string
          description: string
          entry_status: string
          expense_date: string
          fx_rate: number
          has_valid_vat_invoice: boolean
          id: string
          input_vat_claimable: number
          job_id: string | null
          net_amount: number
          notes: string | null
          payment_source: string
          query_note: string | null
          receipt_path: string | null
          recharge_markup_pct: number
          rechargeable: boolean
          recurring_expense_id: string | null
          reimbursement_status: string | null
          review_status: Database["public"]["Enums"]["review_status"]
          reviewed_at: string | null
          reviewed_by: string | null
          staff_id: string | null
          staff_payment_id: string | null
          supplier_id: string | null
          tax_amount: number
          tax_code_id: string | null
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          account_id?: string | null
          amount: number
          category_id: string
          claim_decided_at?: string | null
          claim_decided_by?: string | null
          claim_note?: string | null
          company_id?: string
          created_at?: string
          created_by?: string | null
          currency?: string
          description: string
          entry_status?: string
          expense_date: string
          fx_rate?: number
          has_valid_vat_invoice?: boolean
          id?: string
          input_vat_claimable?: number
          job_id?: string | null
          net_amount?: number
          notes?: string | null
          payment_source: string
          query_note?: string | null
          receipt_path?: string | null
          recharge_markup_pct?: number
          rechargeable?: boolean
          recurring_expense_id?: string | null
          reimbursement_status?: string | null
          review_status?: Database["public"]["Enums"]["review_status"]
          reviewed_at?: string | null
          reviewed_by?: string | null
          staff_id?: string | null
          staff_payment_id?: string | null
          supplier_id?: string | null
          tax_amount?: number
          tax_code_id?: string | null
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          account_id?: string | null
          amount?: number
          category_id?: string
          claim_decided_at?: string | null
          claim_decided_by?: string | null
          claim_note?: string | null
          company_id?: string
          created_at?: string
          created_by?: string | null
          currency?: string
          description?: string
          entry_status?: string
          expense_date?: string
          fx_rate?: number
          has_valid_vat_invoice?: boolean
          id?: string
          input_vat_claimable?: number
          job_id?: string | null
          net_amount?: number
          notes?: string | null
          payment_source?: string
          query_note?: string | null
          receipt_path?: string | null
          recharge_markup_pct?: number
          rechargeable?: boolean
          recurring_expense_id?: string | null
          reimbursement_status?: string | null
          review_status?: Database["public"]["Enums"]["review_status"]
          reviewed_at?: string | null
          reviewed_by?: string | null
          staff_id?: string | null
          staff_payment_id?: string | null
          supplier_id?: string | null
          tax_amount?: number
          tax_code_id?: string | null
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "expenses_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "account_balances"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "expenses_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "account_picker"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "expenses_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "expenses_category_id_fkey"
            columns: ["category_id"]
            isOneToOne: false
            referencedRelation: "expense_categories"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "expenses_claim_decided_by_fkey"
            columns: ["claim_decided_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "expenses_claim_decided_by_fkey"
            columns: ["claim_decided_by"]
            isOneToOne: false
            referencedRelation: "user_directory"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "expenses_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "expenses_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "job_hours_vs_budget"
            referencedColumns: ["job_id"]
          },
          {
            foreignKeyName: "expenses_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "job_milestone_check"
            referencedColumns: ["job_id"]
          },
          {
            foreignKeyName: "expenses_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "job_money_status"
            referencedColumns: ["job_id"]
          },
          {
            foreignKeyName: "expenses_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "jobs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "expenses_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "jobs_flagged"
            referencedColumns: ["job_id"]
          },
          {
            foreignKeyName: "expenses_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "my_jobs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "expenses_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "retention_by_job"
            referencedColumns: ["job_id"]
          },
          {
            foreignKeyName: "expenses_recurring_fk"
            columns: ["recurring_expense_id"]
            isOneToOne: false
            referencedRelation: "recurring_expenses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "expenses_reviewed_by_fkey"
            columns: ["reviewed_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "expenses_reviewed_by_fkey"
            columns: ["reviewed_by"]
            isOneToOne: false
            referencedRelation: "user_directory"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "expenses_staff_id_fkey"
            columns: ["staff_id"]
            isOneToOne: false
            referencedRelation: "staff"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "expenses_staff_payment_fk"
            columns: ["staff_payment_id"]
            isOneToOne: false
            referencedRelation: "staff_payments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "expenses_supplier_id_fkey"
            columns: ["supplier_id"]
            isOneToOne: false
            referencedRelation: "suppliers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "expenses_tax_code_id_fkey"
            columns: ["tax_code_id"]
            isOneToOne: false
            referencedRelation: "tax_codes"
            referencedColumns: ["id"]
          },
        ]
      }
      invoice_line_taxes: {
        Row: {
          amount: number
          base: number
          basis: string
          is_vat: boolean
          line_id: string
          name: string
          rate: number
          seq: number
        }
        Insert: {
          amount: number
          base: number
          basis: string
          is_vat: boolean
          line_id: string
          name: string
          rate: number
          seq: number
        }
        Update: {
          amount?: number
          base?: number
          basis?: string
          is_vat?: boolean
          line_id?: string
          name?: string
          rate?: number
          seq?: number
        }
        Relationships: [
          {
            foreignKeyName: "invoice_line_taxes_line_id_fkey"
            columns: ["line_id"]
            isOneToOne: false
            referencedRelation: "invoice_lines"
            referencedColumns: ["id"]
          },
        ]
      }
      invoice_lines: {
        Row: {
          billing_milestone_id: string | null
          created_at: string
          description: string
          expense_id: string | null
          gross_amount: number
          id: string
          invoice_id: string
          line_type: string
          net_amount: number
          seq: number
          tax_amount: number
          tax_code_id: string | null
          vat_withholding_rate: number
        }
        Insert: {
          billing_milestone_id?: string | null
          created_at?: string
          description: string
          expense_id?: string | null
          gross_amount?: number
          id?: string
          invoice_id: string
          line_type?: string
          net_amount: number
          seq?: number
          tax_amount?: number
          tax_code_id?: string | null
          vat_withholding_rate?: number
        }
        Update: {
          billing_milestone_id?: string | null
          created_at?: string
          description?: string
          expense_id?: string | null
          gross_amount?: number
          id?: string
          invoice_id?: string
          line_type?: string
          net_amount?: number
          seq?: number
          tax_amount?: number
          tax_code_id?: string | null
          vat_withholding_rate?: number
        }
        Relationships: [
          {
            foreignKeyName: "invoice_lines_billing_milestone_id_fkey"
            columns: ["billing_milestone_id"]
            isOneToOne: true
            referencedRelation: "billing_milestones"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invoice_lines_expense_fk"
            columns: ["expense_id"]
            isOneToOne: true
            referencedRelation: "expenses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invoice_lines_expense_fk"
            columns: ["expense_id"]
            isOneToOne: true
            referencedRelation: "supplier_bills_open"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invoice_lines_invoice_id_fkey"
            columns: ["invoice_id"]
            isOneToOne: false
            referencedRelation: "invoices"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invoice_lines_invoice_id_fkey"
            columns: ["invoice_id"]
            isOneToOne: false
            referencedRelation: "invoices_to_chase"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invoice_lines_invoice_id_fkey"
            columns: ["invoice_id"]
            isOneToOne: false
            referencedRelation: "receivables_ageing"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invoice_lines_tax_code_id_fkey"
            columns: ["tax_code_id"]
            isOneToOne: false
            referencedRelation: "tax_codes"
            referencedColumns: ["id"]
          },
        ]
      }
      invoices: {
        Row: {
          approved_at: string | null
          approved_by: string | null
          client_id: string
          client_is_vat_agent: boolean
          company_id: string
          confirmed_settled_total: number
          created_at: string
          created_by: string | null
          credited_total: number
          currency: string
          dispute_date: string | null
          dispute_next_step: string | null
          dispute_reason: string | null
          draft_ref: string
          due_date: string | null
          expected_net_receipt: number
          expected_vat_withheld: number
          expected_wht: number
          fx_rate: number
          gra_einvoice_ref: string | null
          gross_total: number
          id: string
          invoice_date: string
          invoice_number: string | null
          is_imported: boolean
          job_id: string
          net_total: number
          notes: string | null
          outstanding: number
          ready_for_approval: boolean
          retention_amount: number
          retention_basis: string
          retention_pct: number
          sent_at: string | null
          sent_by: string | null
          settled_total: number
          status: string
          tax_total: number
          updated_at: string
          wht_base: string
          wht_rate: number
          write_off_amount: number | null
          write_off_reason: string | null
          written_off_at: string | null
          written_off_by: string | null
        }
        Insert: {
          approved_at?: string | null
          approved_by?: string | null
          client_id: string
          client_is_vat_agent?: boolean
          company_id?: string
          confirmed_settled_total?: number
          created_at?: string
          created_by?: string | null
          credited_total?: number
          currency?: string
          dispute_date?: string | null
          dispute_next_step?: string | null
          dispute_reason?: string | null
          draft_ref?: string
          due_date?: string | null
          expected_net_receipt?: number
          expected_vat_withheld?: number
          expected_wht?: number
          fx_rate?: number
          gra_einvoice_ref?: string | null
          gross_total?: number
          id?: string
          invoice_date?: string
          invoice_number?: string | null
          is_imported?: boolean
          job_id: string
          net_total?: number
          notes?: string | null
          outstanding?: number
          ready_for_approval?: boolean
          retention_amount?: number
          retention_basis?: string
          retention_pct?: number
          sent_at?: string | null
          sent_by?: string | null
          settled_total?: number
          status?: string
          tax_total?: number
          updated_at?: string
          wht_base?: string
          wht_rate?: number
          write_off_amount?: number | null
          write_off_reason?: string | null
          written_off_at?: string | null
          written_off_by?: string | null
        }
        Update: {
          approved_at?: string | null
          approved_by?: string | null
          client_id?: string
          client_is_vat_agent?: boolean
          company_id?: string
          confirmed_settled_total?: number
          created_at?: string
          created_by?: string | null
          credited_total?: number
          currency?: string
          dispute_date?: string | null
          dispute_next_step?: string | null
          dispute_reason?: string | null
          draft_ref?: string
          due_date?: string | null
          expected_net_receipt?: number
          expected_vat_withheld?: number
          expected_wht?: number
          fx_rate?: number
          gra_einvoice_ref?: string | null
          gross_total?: number
          id?: string
          invoice_date?: string
          invoice_number?: string | null
          is_imported?: boolean
          job_id?: string
          net_total?: number
          notes?: string | null
          outstanding?: number
          ready_for_approval?: boolean
          retention_amount?: number
          retention_basis?: string
          retention_pct?: number
          sent_at?: string | null
          sent_by?: string | null
          settled_total?: number
          status?: string
          tax_total?: number
          updated_at?: string
          wht_base?: string
          wht_rate?: number
          write_off_amount?: number | null
          write_off_reason?: string | null
          written_off_at?: string | null
          written_off_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "invoices_approved_by_fkey"
            columns: ["approved_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "invoices_approved_by_fkey"
            columns: ["approved_by"]
            isOneToOne: false
            referencedRelation: "user_directory"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "invoices_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invoices_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "retention_by_job"
            referencedColumns: ["client_id"]
          },
          {
            foreignKeyName: "invoices_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invoices_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "job_hours_vs_budget"
            referencedColumns: ["job_id"]
          },
          {
            foreignKeyName: "invoices_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "job_milestone_check"
            referencedColumns: ["job_id"]
          },
          {
            foreignKeyName: "invoices_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "job_money_status"
            referencedColumns: ["job_id"]
          },
          {
            foreignKeyName: "invoices_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "jobs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invoices_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "jobs_flagged"
            referencedColumns: ["job_id"]
          },
          {
            foreignKeyName: "invoices_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "my_jobs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invoices_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "retention_by_job"
            referencedColumns: ["job_id"]
          },
          {
            foreignKeyName: "invoices_sent_by_fkey"
            columns: ["sent_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "invoices_sent_by_fkey"
            columns: ["sent_by"]
            isOneToOne: false
            referencedRelation: "user_directory"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "invoices_written_off_by_fkey"
            columns: ["written_off_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "invoices_written_off_by_fkey"
            columns: ["written_off_by"]
            isOneToOne: false
            referencedRelation: "user_directory"
            referencedColumns: ["user_id"]
          },
        ]
      }
      job_contracts: {
        Row: {
          created_at: string
          created_by: string | null
          doc_date: string | null
          doc_type: string
          file_path: string | null
          id: string
          job_id: string
          liability_cap: string | null
          notes: string | null
          parties: string | null
          payment_terms: string | null
          retention_terms: string | null
          value: number | null
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          doc_date?: string | null
          doc_type: string
          file_path?: string | null
          id?: string
          job_id: string
          liability_cap?: string | null
          notes?: string | null
          parties?: string | null
          payment_terms?: string | null
          retention_terms?: string | null
          value?: number | null
        }
        Update: {
          created_at?: string
          created_by?: string | null
          doc_date?: string | null
          doc_type?: string
          file_path?: string | null
          id?: string
          job_id?: string
          liability_cap?: string | null
          notes?: string | null
          parties?: string | null
          payment_terms?: string | null
          retention_terms?: string | null
          value?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "job_contracts_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "job_hours_vs_budget"
            referencedColumns: ["job_id"]
          },
          {
            foreignKeyName: "job_contracts_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "job_milestone_check"
            referencedColumns: ["job_id"]
          },
          {
            foreignKeyName: "job_contracts_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "job_money_status"
            referencedColumns: ["job_id"]
          },
          {
            foreignKeyName: "job_contracts_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "jobs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "job_contracts_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "jobs_flagged"
            referencedColumns: ["job_id"]
          },
          {
            foreignKeyName: "job_contracts_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "my_jobs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "job_contracts_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "retention_by_job"
            referencedColumns: ["job_id"]
          },
        ]
      }
      job_hour_budgets: {
        Row: {
          budget_role_id: string
          hours: number
          job_id: string
        }
        Insert: {
          budget_role_id: string
          hours: number
          job_id: string
        }
        Update: {
          budget_role_id?: string
          hours?: number
          job_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "job_hour_budgets_budget_role_id_fkey"
            columns: ["budget_role_id"]
            isOneToOne: false
            referencedRelation: "budget_roles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "job_hour_budgets_budget_role_id_fkey"
            columns: ["budget_role_id"]
            isOneToOne: false
            referencedRelation: "job_hours_vs_budget"
            referencedColumns: ["budget_role_id"]
          },
          {
            foreignKeyName: "job_hour_budgets_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "job_hours_vs_budget"
            referencedColumns: ["job_id"]
          },
          {
            foreignKeyName: "job_hour_budgets_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "job_milestone_check"
            referencedColumns: ["job_id"]
          },
          {
            foreignKeyName: "job_hour_budgets_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "job_money_status"
            referencedColumns: ["job_id"]
          },
          {
            foreignKeyName: "job_hour_budgets_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "jobs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "job_hour_budgets_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "jobs_flagged"
            referencedColumns: ["job_id"]
          },
          {
            foreignKeyName: "job_hour_budgets_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "my_jobs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "job_hour_budgets_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "retention_by_job"
            referencedColumns: ["job_id"]
          },
        ]
      }
      job_team: {
        Row: {
          job_id: string
          staff_id: string
        }
        Insert: {
          job_id: string
          staff_id: string
        }
        Update: {
          job_id?: string
          staff_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "job_team_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "job_hours_vs_budget"
            referencedColumns: ["job_id"]
          },
          {
            foreignKeyName: "job_team_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "job_milestone_check"
            referencedColumns: ["job_id"]
          },
          {
            foreignKeyName: "job_team_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "job_money_status"
            referencedColumns: ["job_id"]
          },
          {
            foreignKeyName: "job_team_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "jobs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "job_team_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "jobs_flagged"
            referencedColumns: ["job_id"]
          },
          {
            foreignKeyName: "job_team_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "my_jobs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "job_team_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "retention_by_job"
            referencedColumns: ["job_id"]
          },
          {
            foreignKeyName: "job_team_staff_id_fkey"
            columns: ["staff_id"]
            isOneToOne: false
            referencedRelation: "staff"
            referencedColumns: ["id"]
          },
        ]
      }
      job_types: {
        Row: {
          id: string
          is_active: boolean
          name: string
          sort_order: number
        }
        Insert: {
          id?: string
          is_active?: boolean
          name: string
          sort_order?: number
        }
        Update: {
          id?: string
          is_active?: boolean
          name?: string
          sort_order?: number
        }
        Relationships: []
      }
      jobs: {
        Row: {
          client_id: string
          company_id: string
          construction_value: number | null
          contract_mode: string
          created_at: string
          created_by: string | null
          currency: string
          delivery_status: string
          due_date: string | null
          fee: number | null
          fee_basis: string
          fee_percent: number | null
          id: string
          is_goodwill: boolean
          is_imported: boolean
          job_number: string | null
          job_type_id: string | null
          notes: string | null
          percent_complete: number
          project_lead_staff_id: string | null
          referrer_id: string | null
          retention_basis: string
          retention_pct: number
          retention_release_date: string | null
          retention_release_terms: string | null
          start_date: string | null
          title: string
          updated_at: string
        }
        Insert: {
          client_id: string
          company_id?: string
          construction_value?: number | null
          contract_mode?: string
          created_at?: string
          created_by?: string | null
          currency?: string
          delivery_status?: string
          due_date?: string | null
          fee?: number | null
          fee_basis?: string
          fee_percent?: number | null
          id?: string
          is_goodwill?: boolean
          is_imported?: boolean
          job_number?: string | null
          job_type_id?: string | null
          notes?: string | null
          percent_complete?: number
          project_lead_staff_id?: string | null
          referrer_id?: string | null
          retention_basis?: string
          retention_pct?: number
          retention_release_date?: string | null
          retention_release_terms?: string | null
          start_date?: string | null
          title: string
          updated_at?: string
        }
        Update: {
          client_id?: string
          company_id?: string
          construction_value?: number | null
          contract_mode?: string
          created_at?: string
          created_by?: string | null
          currency?: string
          delivery_status?: string
          due_date?: string | null
          fee?: number | null
          fee_basis?: string
          fee_percent?: number | null
          id?: string
          is_goodwill?: boolean
          is_imported?: boolean
          job_number?: string | null
          job_type_id?: string | null
          notes?: string | null
          percent_complete?: number
          project_lead_staff_id?: string | null
          referrer_id?: string | null
          retention_basis?: string
          retention_pct?: number
          retention_release_date?: string | null
          retention_release_terms?: string | null
          start_date?: string | null
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "jobs_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "jobs_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "retention_by_job"
            referencedColumns: ["client_id"]
          },
          {
            foreignKeyName: "jobs_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "jobs_job_type_id_fkey"
            columns: ["job_type_id"]
            isOneToOne: false
            referencedRelation: "job_types"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "jobs_project_lead_staff_id_fkey"
            columns: ["project_lead_staff_id"]
            isOneToOne: false
            referencedRelation: "staff"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "jobs_referrer_id_fkey"
            columns: ["referrer_id"]
            isOneToOne: false
            referencedRelation: "referrers"
            referencedColumns: ["id"]
          },
        ]
      }
      leave_entitlements: {
        Row: {
          carried_over_days: number
          created_at: string
          entitled_days: number
          id: string
          leave_type_id: string
          leave_year: number
          notes: string | null
          staff_id: string
          updated_at: string
        }
        Insert: {
          carried_over_days?: number
          created_at?: string
          entitled_days: number
          id?: string
          leave_type_id: string
          leave_year: number
          notes?: string | null
          staff_id: string
          updated_at?: string
        }
        Update: {
          carried_over_days?: number
          created_at?: string
          entitled_days?: number
          id?: string
          leave_type_id?: string
          leave_year?: number
          notes?: string | null
          staff_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "leave_entitlements_leave_type_id_fkey"
            columns: ["leave_type_id"]
            isOneToOne: false
            referencedRelation: "leave_types"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "leave_entitlements_staff_id_fkey"
            columns: ["staff_id"]
            isOneToOne: false
            referencedRelation: "staff"
            referencedColumns: ["id"]
          },
        ]
      }
      leave_requests: {
        Row: {
          created_at: string
          created_by: string | null
          decided_at: string | null
          decided_by: string | null
          decision_note: string | null
          document_path: string | null
          end_date: string
          id: string
          leave_type_id: string
          reason: string | null
          staff_id: string
          start_date: string
          status: string
          updated_at: string
          working_days: number
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          decided_at?: string | null
          decided_by?: string | null
          decision_note?: string | null
          document_path?: string | null
          end_date: string
          id?: string
          leave_type_id: string
          reason?: string | null
          staff_id: string
          start_date: string
          status?: string
          updated_at?: string
          working_days?: number
        }
        Update: {
          created_at?: string
          created_by?: string | null
          decided_at?: string | null
          decided_by?: string | null
          decision_note?: string | null
          document_path?: string | null
          end_date?: string
          id?: string
          leave_type_id?: string
          reason?: string | null
          staff_id?: string
          start_date?: string
          status?: string
          updated_at?: string
          working_days?: number
        }
        Relationships: [
          {
            foreignKeyName: "leave_requests_decided_by_fkey"
            columns: ["decided_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "leave_requests_decided_by_fkey"
            columns: ["decided_by"]
            isOneToOne: false
            referencedRelation: "user_directory"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "leave_requests_leave_type_id_fkey"
            columns: ["leave_type_id"]
            isOneToOne: false
            referencedRelation: "leave_types"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "leave_requests_staff_id_fkey"
            columns: ["staff_id"]
            isOneToOne: false
            referencedRelation: "staff"
            referencedColumns: ["id"]
          },
        ]
      }
      leave_types: {
        Row: {
          default_entitled_days: number | null
          document_after_days: number | null
          id: string
          is_active: boolean
          is_paid: boolean
          name: string
          requires_document: boolean
          sort_order: number
          uses_annual_balance: boolean
        }
        Insert: {
          default_entitled_days?: number | null
          document_after_days?: number | null
          id?: string
          is_active?: boolean
          is_paid?: boolean
          name: string
          requires_document?: boolean
          sort_order?: number
          uses_annual_balance?: boolean
        }
        Update: {
          default_entitled_days?: number | null
          document_after_days?: number | null
          id?: string
          is_active?: boolean
          is_paid?: boolean
          name?: string
          requires_document?: boolean
          sort_order?: number
          uses_annual_balance?: boolean
        }
        Relationships: []
      }
      ledger_entries: {
        Row: {
          account_id: string | null
          amount: number
          company_id: string
          created_at: string
          currency: string
          description: string | null
          director_id: string | null
          entry_date: string
          fx_rate: number
          id: number
          source_id: string
          source_type: string
        }
        Insert: {
          account_id?: string | null
          amount: number
          company_id?: string
          created_at?: string
          currency?: string
          description?: string | null
          director_id?: string | null
          entry_date: string
          fx_rate?: number
          id?: never
          source_id: string
          source_type: string
        }
        Update: {
          account_id?: string | null
          amount?: number
          company_id?: string
          created_at?: string
          currency?: string
          description?: string | null
          director_id?: string | null
          entry_date?: string
          fx_rate?: number
          id?: never
          source_id?: string
          source_type?: string
        }
        Relationships: [
          {
            foreignKeyName: "ledger_entries_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "account_balances"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ledger_entries_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "account_picker"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ledger_entries_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ledger_entries_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ledger_entries_director_id_fkey"
            columns: ["director_id"]
            isOneToOne: false
            referencedRelation: "director_balances"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ledger_entries_director_id_fkey"
            columns: ["director_id"]
            isOneToOne: false
            referencedRelation: "directors"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ledger_entries_director_id_fkey"
            columns: ["director_id"]
            isOneToOne: false
            referencedRelation: "user_directory"
            referencedColumns: ["director_id"]
          },
        ]
      }
      month_closes: {
        Row: {
          accountant_checklist: Json
          admin_checklist: Json
          admin_completed_at: string | null
          admin_completed_by: string | null
          closed_at: string | null
          closed_by: string | null
          month: string
          owner_reviewed_at: string | null
          status: string
          updated_at: string
        }
        Insert: {
          accountant_checklist?: Json
          admin_checklist?: Json
          admin_completed_at?: string | null
          admin_completed_by?: string | null
          closed_at?: string | null
          closed_by?: string | null
          month: string
          owner_reviewed_at?: string | null
          status?: string
          updated_at?: string
        }
        Update: {
          accountant_checklist?: Json
          admin_checklist?: Json
          admin_completed_at?: string | null
          admin_completed_by?: string | null
          closed_at?: string | null
          closed_by?: string | null
          month?: string
          owner_reviewed_at?: string | null
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "month_closes_admin_completed_by_fkey"
            columns: ["admin_completed_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "month_closes_admin_completed_by_fkey"
            columns: ["admin_completed_by"]
            isOneToOne: false
            referencedRelation: "user_directory"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "month_closes_closed_by_fkey"
            columns: ["closed_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "month_closes_closed_by_fkey"
            columns: ["closed_by"]
            isOneToOne: false
            referencedRelation: "user_directory"
            referencedColumns: ["user_id"]
          },
        ]
      }
      month_reopenings: {
        Row: {
          id: string
          month: string
          reason: string
          reopened_at: string
          reopened_by: string
        }
        Insert: {
          id?: string
          month: string
          reason: string
          reopened_at?: string
          reopened_by?: string
        }
        Update: {
          id?: string
          month?: string
          reason?: string
          reopened_at?: string
          reopened_by?: string
        }
        Relationships: [
          {
            foreignKeyName: "month_reopenings_month_fkey"
            columns: ["month"]
            isOneToOne: false
            referencedRelation: "month_closes"
            referencedColumns: ["month"]
          },
          {
            foreignKeyName: "month_reopenings_reopened_by_fkey"
            columns: ["reopened_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "month_reopenings_reopened_by_fkey"
            columns: ["reopened_by"]
            isOneToOne: false
            referencedRelation: "user_directory"
            referencedColumns: ["user_id"]
          },
        ]
      }
      notifications: {
        Row: {
          body: string | null
          created_at: string
          emailed_at: string | null
          id: string
          kind: string
          link: string
          read_at: string | null
          recipient_id: string
          record_id: string | null
          record_type: string | null
          reminder_key: string | null
          send_email: boolean
          title: string
        }
        Insert: {
          body?: string | null
          created_at?: string
          emailed_at?: string | null
          id?: string
          kind: string
          link: string
          read_at?: string | null
          recipient_id: string
          record_id?: string | null
          record_type?: string | null
          reminder_key?: string | null
          send_email?: boolean
          title: string
        }
        Update: {
          body?: string | null
          created_at?: string
          emailed_at?: string | null
          id?: string
          kind?: string
          link?: string
          read_at?: string | null
          recipient_id?: string
          record_id?: string | null
          record_type?: string | null
          reminder_key?: string | null
          send_email?: boolean
          title?: string
        }
        Relationships: [
          {
            foreignKeyName: "notifications_recipient_id_fkey"
            columns: ["recipient_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "notifications_recipient_id_fkey"
            columns: ["recipient_id"]
            isOneToOne: false
            referencedRelation: "user_directory"
            referencedColumns: ["user_id"]
          },
        ]
      }
      number_sequences: {
        Row: {
          last_value: number
          series: string
          year: number
        }
        Insert: {
          last_value?: number
          series: string
          year: number
        }
        Update: {
          last_value?: number
          series?: string
          year?: number
        }
        Relationships: []
      }
      payment_out_items: {
        Row: {
          amount: number
          expense_id: string
          id: string
          payment_out_id: string
        }
        Insert: {
          amount: number
          expense_id: string
          id?: string
          payment_out_id: string
        }
        Update: {
          amount?: number
          expense_id?: string
          id?: string
          payment_out_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "payment_out_items_expense_id_fkey"
            columns: ["expense_id"]
            isOneToOne: false
            referencedRelation: "expenses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payment_out_items_expense_id_fkey"
            columns: ["expense_id"]
            isOneToOne: false
            referencedRelation: "supplier_bills_open"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payment_out_items_payment_out_id_fkey"
            columns: ["payment_out_id"]
            isOneToOne: false
            referencedRelation: "payments_out"
            referencedColumns: ["id"]
          },
        ]
      }
      payments_out: {
        Row: {
          account_id: string | null
          approved_at: string | null
          approved_by: string | null
          attachment_path: string | null
          company_id: string
          created_at: string
          created_by: string | null
          currency: string
          description: string | null
          fx_rate: number
          gross_amount: number
          id: string
          job_id: string | null
          method: string | null
          net_amount: number
          notes: string | null
          paid_at: string | null
          paid_by: string | null
          payment_date: string | null
          prepared_by: string | null
          query_note: string | null
          reference: string | null
          review_status: Database["public"]["Enums"]["review_status"]
          reviewed_at: string | null
          reviewed_by: string | null
          status: Database["public"]["Enums"]["payout_status"]
          supplier_id: string
          updated_at: string
          updated_by: string | null
          wht_amount: number
          wht_rate: number
        }
        Insert: {
          account_id?: string | null
          approved_at?: string | null
          approved_by?: string | null
          attachment_path?: string | null
          company_id?: string
          created_at?: string
          created_by?: string | null
          currency?: string
          description?: string | null
          fx_rate?: number
          gross_amount?: number
          id?: string
          job_id?: string | null
          method?: string | null
          net_amount?: number
          notes?: string | null
          paid_at?: string | null
          paid_by?: string | null
          payment_date?: string | null
          prepared_by?: string | null
          query_note?: string | null
          reference?: string | null
          review_status?: Database["public"]["Enums"]["review_status"]
          reviewed_at?: string | null
          reviewed_by?: string | null
          status?: Database["public"]["Enums"]["payout_status"]
          supplier_id: string
          updated_at?: string
          updated_by?: string | null
          wht_amount?: number
          wht_rate?: number
        }
        Update: {
          account_id?: string | null
          approved_at?: string | null
          approved_by?: string | null
          attachment_path?: string | null
          company_id?: string
          created_at?: string
          created_by?: string | null
          currency?: string
          description?: string | null
          fx_rate?: number
          gross_amount?: number
          id?: string
          job_id?: string | null
          method?: string | null
          net_amount?: number
          notes?: string | null
          paid_at?: string | null
          paid_by?: string | null
          payment_date?: string | null
          prepared_by?: string | null
          query_note?: string | null
          reference?: string | null
          review_status?: Database["public"]["Enums"]["review_status"]
          reviewed_at?: string | null
          reviewed_by?: string | null
          status?: Database["public"]["Enums"]["payout_status"]
          supplier_id?: string
          updated_at?: string
          updated_by?: string | null
          wht_amount?: number
          wht_rate?: number
        }
        Relationships: [
          {
            foreignKeyName: "payments_out_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "account_balances"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payments_out_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "account_picker"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payments_out_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payments_out_approved_by_fkey"
            columns: ["approved_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "payments_out_approved_by_fkey"
            columns: ["approved_by"]
            isOneToOne: false
            referencedRelation: "user_directory"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "payments_out_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payments_out_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "job_hours_vs_budget"
            referencedColumns: ["job_id"]
          },
          {
            foreignKeyName: "payments_out_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "job_milestone_check"
            referencedColumns: ["job_id"]
          },
          {
            foreignKeyName: "payments_out_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "job_money_status"
            referencedColumns: ["job_id"]
          },
          {
            foreignKeyName: "payments_out_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "jobs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payments_out_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "jobs_flagged"
            referencedColumns: ["job_id"]
          },
          {
            foreignKeyName: "payments_out_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "my_jobs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payments_out_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "retention_by_job"
            referencedColumns: ["job_id"]
          },
          {
            foreignKeyName: "payments_out_paid_by_fkey"
            columns: ["paid_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "payments_out_paid_by_fkey"
            columns: ["paid_by"]
            isOneToOne: false
            referencedRelation: "user_directory"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "payments_out_prepared_by_fkey"
            columns: ["prepared_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "payments_out_prepared_by_fkey"
            columns: ["prepared_by"]
            isOneToOne: false
            referencedRelation: "user_directory"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "payments_out_reviewed_by_fkey"
            columns: ["reviewed_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "payments_out_reviewed_by_fkey"
            columns: ["reviewed_by"]
            isOneToOne: false
            referencedRelation: "user_directory"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "payments_out_supplier_id_fkey"
            columns: ["supplier_id"]
            isOneToOne: false
            referencedRelation: "suppliers"
            referencedColumns: ["id"]
          },
        ]
      }
      payroll_column_maps: {
        Row: {
          created_at: string
          created_by: string | null
          effective_from: string
          first_data_row: number
          header_row: number
          id: string
          mapping: Json
          notes: string | null
          sheet_kind: string
          sheet_name: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          effective_from: string
          first_data_row?: number
          header_row?: number
          id?: string
          mapping: Json
          notes?: string | null
          sheet_kind: string
          sheet_name: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          effective_from?: string
          first_data_row?: number
          header_row?: number
          id?: string
          mapping?: Json
          notes?: string | null
          sheet_kind?: string
          sheet_name?: string
        }
        Relationships: []
      }
      payroll_lines: {
        Row: {
          advance_recovery: number
          bank_amount: number
          basic: number
          bonus: number
          bonus_paye: number
          created_at: string
          created_by: string | null
          full_cost_to_company: number
          gross: number
          id: string
          is_national_service: boolean
          loan_deduction: number
          net_pay: number
          notes: string | null
          other_deductions: number
          paye: number
          pf_employee: number
          pf_employer: number
          post_tax_allowance_detail: Json
          post_tax_allowances: number
          run_id: string
          sheet_cost_to_company: number | null
          sheet_kind: string
          source: string
          ssnit_employee: number
          ssnit_employer: number
          staff_id: string
          taxable_allowance_detail: Json
          taxable_allowances: number
          taxable_income: number
          tier1_amount: number
          tier2_amount: number
        }
        Insert: {
          advance_recovery?: number
          bank_amount?: number
          basic?: number
          bonus?: number
          bonus_paye?: number
          created_at?: string
          created_by?: string | null
          full_cost_to_company?: number
          gross?: number
          id?: string
          is_national_service?: boolean
          loan_deduction?: number
          net_pay?: number
          notes?: string | null
          other_deductions?: number
          paye?: number
          pf_employee?: number
          pf_employer?: number
          post_tax_allowance_detail?: Json
          post_tax_allowances?: number
          run_id: string
          sheet_cost_to_company?: number | null
          sheet_kind?: string
          source?: string
          ssnit_employee?: number
          ssnit_employer?: number
          staff_id: string
          taxable_allowance_detail?: Json
          taxable_allowances?: number
          taxable_income?: number
          tier1_amount?: number
          tier2_amount?: number
        }
        Update: {
          advance_recovery?: number
          bank_amount?: number
          basic?: number
          bonus?: number
          bonus_paye?: number
          created_at?: string
          created_by?: string | null
          full_cost_to_company?: number
          gross?: number
          id?: string
          is_national_service?: boolean
          loan_deduction?: number
          net_pay?: number
          notes?: string | null
          other_deductions?: number
          paye?: number
          pf_employee?: number
          pf_employer?: number
          post_tax_allowance_detail?: Json
          post_tax_allowances?: number
          run_id?: string
          sheet_cost_to_company?: number | null
          sheet_kind?: string
          source?: string
          ssnit_employee?: number
          ssnit_employer?: number
          staff_id?: string
          taxable_allowance_detail?: Json
          taxable_allowances?: number
          taxable_income?: number
          tier1_amount?: number
          tier2_amount?: number
        }
        Relationships: [
          {
            foreignKeyName: "payroll_lines_run_id_fkey"
            columns: ["run_id"]
            isOneToOne: false
            referencedRelation: "payroll_cost_changes"
            referencedColumns: ["run_id"]
          },
          {
            foreignKeyName: "payroll_lines_run_id_fkey"
            columns: ["run_id"]
            isOneToOne: false
            referencedRelation: "payroll_runs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payroll_lines_staff_id_fkey"
            columns: ["staff_id"]
            isOneToOne: false
            referencedRelation: "staff"
            referencedColumns: ["id"]
          },
        ]
      }
      payroll_runs: {
        Row: {
          account_id: string | null
          approved_at: string | null
          approved_by: string | null
          company_id: string
          created_at: string
          created_by: string | null
          id: string
          issued_at: string | null
          issued_by: string | null
          notes: string | null
          paid_date: string | null
          paid_recorded_by: string | null
          period_month: string
          query_note: string | null
          review_status: Database["public"]["Enums"]["review_status"]
          reviewed_at: string | null
          reviewed_by: string | null
          run_kind: string
          sheet_totals: Json
          source_files: Json
          status: string
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          account_id?: string | null
          approved_at?: string | null
          approved_by?: string | null
          company_id?: string
          created_at?: string
          created_by?: string | null
          id?: string
          issued_at?: string | null
          issued_by?: string | null
          notes?: string | null
          paid_date?: string | null
          paid_recorded_by?: string | null
          period_month: string
          query_note?: string | null
          review_status?: Database["public"]["Enums"]["review_status"]
          reviewed_at?: string | null
          reviewed_by?: string | null
          run_kind?: string
          sheet_totals?: Json
          source_files?: Json
          status?: string
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          account_id?: string | null
          approved_at?: string | null
          approved_by?: string | null
          company_id?: string
          created_at?: string
          created_by?: string | null
          id?: string
          issued_at?: string | null
          issued_by?: string | null
          notes?: string | null
          paid_date?: string | null
          paid_recorded_by?: string | null
          period_month?: string
          query_note?: string | null
          review_status?: Database["public"]["Enums"]["review_status"]
          reviewed_at?: string | null
          reviewed_by?: string | null
          run_kind?: string
          sheet_totals?: Json
          source_files?: Json
          status?: string
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "payroll_runs_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "account_balances"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payroll_runs_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "account_picker"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payroll_runs_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payroll_runs_approved_by_fkey"
            columns: ["approved_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "payroll_runs_approved_by_fkey"
            columns: ["approved_by"]
            isOneToOne: false
            referencedRelation: "user_directory"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "payroll_runs_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payroll_runs_issued_by_fkey"
            columns: ["issued_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "payroll_runs_issued_by_fkey"
            columns: ["issued_by"]
            isOneToOne: false
            referencedRelation: "user_directory"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "payroll_runs_paid_recorded_by_fkey"
            columns: ["paid_recorded_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "payroll_runs_paid_recorded_by_fkey"
            columns: ["paid_recorded_by"]
            isOneToOne: false
            referencedRelation: "user_directory"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "payroll_runs_reviewed_by_fkey"
            columns: ["reviewed_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "payroll_runs_reviewed_by_fkey"
            columns: ["reviewed_by"]
            isOneToOne: false
            referencedRelation: "user_directory"
            referencedColumns: ["user_id"]
          },
        ]
      }
      payslips: {
        Row: {
          first_viewed_at: string | null
          id: string
          is_allowance_statement: boolean
          issued_at: string
          payroll_line_id: string
          pdf_path: string | null
          period_month: string
          run_id: string
          staff_id: string
          ytd: Json
        }
        Insert: {
          first_viewed_at?: string | null
          id?: string
          is_allowance_statement?: boolean
          issued_at?: string
          payroll_line_id: string
          pdf_path?: string | null
          period_month: string
          run_id: string
          staff_id: string
          ytd?: Json
        }
        Update: {
          first_viewed_at?: string | null
          id?: string
          is_allowance_statement?: boolean
          issued_at?: string
          payroll_line_id?: string
          pdf_path?: string | null
          period_month?: string
          run_id?: string
          staff_id?: string
          ytd?: Json
        }
        Relationships: [
          {
            foreignKeyName: "payslips_payroll_line_id_fkey"
            columns: ["payroll_line_id"]
            isOneToOne: true
            referencedRelation: "payroll_lines"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payslips_run_id_fkey"
            columns: ["run_id"]
            isOneToOne: false
            referencedRelation: "payroll_cost_changes"
            referencedColumns: ["run_id"]
          },
          {
            foreignKeyName: "payslips_run_id_fkey"
            columns: ["run_id"]
            isOneToOne: false
            referencedRelation: "payroll_runs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payslips_staff_id_fkey"
            columns: ["staff_id"]
            isOneToOne: false
            referencedRelation: "staff"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          created_at: string
          email: string
          full_name: string
          is_active: boolean
          role: Database["public"]["Enums"]["app_role"]
          staff_id: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          email: string
          full_name: string
          is_active?: boolean
          role: Database["public"]["Enums"]["app_role"]
          staff_id?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          email?: string
          full_name?: string
          is_active?: boolean
          role?: Database["public"]["Enums"]["app_role"]
          staff_id?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "profiles_staff_fk"
            columns: ["staff_id"]
            isOneToOne: true
            referencedRelation: "staff"
            referencedColumns: ["id"]
          },
        ]
      }
      public_holidays: {
        Row: {
          created_at: string
          holiday_date: string
          name: string
        }
        Insert: {
          created_at?: string
          holiday_date: string
          name: string
        }
        Update: {
          created_at?: string
          holiday_date?: string
          name?: string
        }
        Relationships: []
      }
      receipt_allocations: {
        Row: {
          cash_amount: number
          id: string
          invoice_id: string
          receipt_id: string
          vat_withheld_amount: number
          wht_amount: number
        }
        Insert: {
          cash_amount?: number
          id?: string
          invoice_id: string
          receipt_id: string
          vat_withheld_amount?: number
          wht_amount?: number
        }
        Update: {
          cash_amount?: number
          id?: string
          invoice_id?: string
          receipt_id?: string
          vat_withheld_amount?: number
          wht_amount?: number
        }
        Relationships: [
          {
            foreignKeyName: "receipt_allocations_invoice_id_fkey"
            columns: ["invoice_id"]
            isOneToOne: false
            referencedRelation: "invoices"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "receipt_allocations_invoice_id_fkey"
            columns: ["invoice_id"]
            isOneToOne: false
            referencedRelation: "invoices_to_chase"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "receipt_allocations_invoice_id_fkey"
            columns: ["invoice_id"]
            isOneToOne: false
            referencedRelation: "receivables_ageing"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "receipt_allocations_receipt_id_fkey"
            columns: ["receipt_id"]
            isOneToOne: false
            referencedRelation: "receipts"
            referencedColumns: ["id"]
          },
        ]
      }
      receipts: {
        Row: {
          account_id: string | null
          attachment_path: string | null
          cash_amount: number
          client_id: string
          company_id: string
          confirmed_at: string | null
          confirmed_by: string | null
          created_at: string
          created_by: string | null
          currency: string
          fx_rate: number
          id: string
          method: string | null
          notes: string | null
          receipt_date: string
          received_by_director_id: string | null
          reference: string | null
          rejection_reason: string | null
          review_note: string | null
          review_status: string
          reviewed_at: string | null
          reviewed_by: string | null
          source: string
          statement_line_id: string | null
          status: string
          updated_at: string
          vat_withheld_amount: number
          wht_amount: number
        }
        Insert: {
          account_id?: string | null
          attachment_path?: string | null
          cash_amount?: number
          client_id: string
          company_id?: string
          confirmed_at?: string | null
          confirmed_by?: string | null
          created_at?: string
          created_by?: string | null
          currency?: string
          fx_rate?: number
          id?: string
          method?: string | null
          notes?: string | null
          receipt_date: string
          received_by_director_id?: string | null
          reference?: string | null
          rejection_reason?: string | null
          review_note?: string | null
          review_status?: string
          reviewed_at?: string | null
          reviewed_by?: string | null
          source: string
          statement_line_id?: string | null
          status?: string
          updated_at?: string
          vat_withheld_amount?: number
          wht_amount?: number
        }
        Update: {
          account_id?: string | null
          attachment_path?: string | null
          cash_amount?: number
          client_id?: string
          company_id?: string
          confirmed_at?: string | null
          confirmed_by?: string | null
          created_at?: string
          created_by?: string | null
          currency?: string
          fx_rate?: number
          id?: string
          method?: string | null
          notes?: string | null
          receipt_date?: string
          received_by_director_id?: string | null
          reference?: string | null
          rejection_reason?: string | null
          review_note?: string | null
          review_status?: string
          reviewed_at?: string | null
          reviewed_by?: string | null
          source?: string
          statement_line_id?: string | null
          status?: string
          updated_at?: string
          vat_withheld_amount?: number
          wht_amount?: number
        }
        Relationships: [
          {
            foreignKeyName: "receipts_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "account_balances"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "receipts_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "account_picker"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "receipts_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "receipts_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "receipts_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "retention_by_job"
            referencedColumns: ["client_id"]
          },
          {
            foreignKeyName: "receipts_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "receipts_confirmed_by_fkey"
            columns: ["confirmed_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "receipts_confirmed_by_fkey"
            columns: ["confirmed_by"]
            isOneToOne: false
            referencedRelation: "user_directory"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "receipts_received_by_director_id_fkey"
            columns: ["received_by_director_id"]
            isOneToOne: false
            referencedRelation: "director_balances"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "receipts_received_by_director_id_fkey"
            columns: ["received_by_director_id"]
            isOneToOne: false
            referencedRelation: "directors"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "receipts_received_by_director_id_fkey"
            columns: ["received_by_director_id"]
            isOneToOne: false
            referencedRelation: "user_directory"
            referencedColumns: ["director_id"]
          },
          {
            foreignKeyName: "receipts_reviewed_by_fkey"
            columns: ["reviewed_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "receipts_reviewed_by_fkey"
            columns: ["reviewed_by"]
            isOneToOne: false
            referencedRelation: "user_directory"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "receipts_statement_line_id_fkey"
            columns: ["statement_line_id"]
            isOneToOne: true
            referencedRelation: "receipt_tasks"
            referencedColumns: ["statement_line_id"]
          },
          {
            foreignKeyName: "receipts_statement_line_id_fkey"
            columns: ["statement_line_id"]
            isOneToOne: true
            referencedRelation: "statement_lines"
            referencedColumns: ["id"]
          },
        ]
      }
      reconciliations: {
        Row: {
          account_id: string
          calculated_balance: number
          closed_at: string | null
          closed_by: string | null
          created_at: string
          created_by: string | null
          difference: number
          explanation: string | null
          id: string
          month: string
          statement_balance: number
          status: string
          updated_at: string
        }
        Insert: {
          account_id: string
          calculated_balance?: number
          closed_at?: string | null
          closed_by?: string | null
          created_at?: string
          created_by?: string | null
          difference?: number
          explanation?: string | null
          id?: string
          month: string
          statement_balance: number
          status?: string
          updated_at?: string
        }
        Update: {
          account_id?: string
          calculated_balance?: number
          closed_at?: string | null
          closed_by?: string | null
          created_at?: string
          created_by?: string | null
          difference?: number
          explanation?: string | null
          id?: string
          month?: string
          statement_balance?: number
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "reconciliations_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "account_balances"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "reconciliations_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "account_picker"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "reconciliations_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "reconciliations_closed_by_fkey"
            columns: ["closed_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "reconciliations_closed_by_fkey"
            columns: ["closed_by"]
            isOneToOne: false
            referencedRelation: "user_directory"
            referencedColumns: ["user_id"]
          },
        ]
      }
      recurring_expenses: {
        Row: {
          account_id: string | null
          category_id: string
          created_at: string
          created_by: string | null
          expected_amount: number
          frequency: string
          id: string
          is_active: boolean
          is_fixed_amount: boolean
          job_id: string | null
          name: string
          next_due_date: string
          notes: string | null
          payment_source: string
          supplier_id: string | null
          tax_code_id: string | null
          updated_at: string
        }
        Insert: {
          account_id?: string | null
          category_id: string
          created_at?: string
          created_by?: string | null
          expected_amount: number
          frequency: string
          id?: string
          is_active?: boolean
          is_fixed_amount?: boolean
          job_id?: string | null
          name: string
          next_due_date: string
          notes?: string | null
          payment_source?: string
          supplier_id?: string | null
          tax_code_id?: string | null
          updated_at?: string
        }
        Update: {
          account_id?: string | null
          category_id?: string
          created_at?: string
          created_by?: string | null
          expected_amount?: number
          frequency?: string
          id?: string
          is_active?: boolean
          is_fixed_amount?: boolean
          job_id?: string | null
          name?: string
          next_due_date?: string
          notes?: string | null
          payment_source?: string
          supplier_id?: string | null
          tax_code_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "recurring_expenses_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "account_balances"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "recurring_expenses_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "account_picker"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "recurring_expenses_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "recurring_expenses_category_id_fkey"
            columns: ["category_id"]
            isOneToOne: false
            referencedRelation: "expense_categories"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "recurring_expenses_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "job_hours_vs_budget"
            referencedColumns: ["job_id"]
          },
          {
            foreignKeyName: "recurring_expenses_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "job_milestone_check"
            referencedColumns: ["job_id"]
          },
          {
            foreignKeyName: "recurring_expenses_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "job_money_status"
            referencedColumns: ["job_id"]
          },
          {
            foreignKeyName: "recurring_expenses_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "jobs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "recurring_expenses_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "jobs_flagged"
            referencedColumns: ["job_id"]
          },
          {
            foreignKeyName: "recurring_expenses_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "my_jobs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "recurring_expenses_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "retention_by_job"
            referencedColumns: ["job_id"]
          },
          {
            foreignKeyName: "recurring_expenses_supplier_id_fkey"
            columns: ["supplier_id"]
            isOneToOne: false
            referencedRelation: "suppliers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "recurring_expenses_tax_code_id_fkey"
            columns: ["tax_code_id"]
            isOneToOne: false
            referencedRelation: "tax_codes"
            referencedColumns: ["id"]
          },
        ]
      }
      referrers: {
        Row: {
          created_at: string
          created_by: string | null
          email: string | null
          id: string
          is_active: boolean
          last_contact_date: string | null
          name: string
          notes: string | null
          organisation: string | null
          phone: string | null
          relationship: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          email?: string | null
          id?: string
          is_active?: boolean
          last_contact_date?: string | null
          name: string
          notes?: string | null
          organisation?: string | null
          phone?: string | null
          relationship?: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          email?: string | null
          id?: string
          is_active?: boolean
          last_contact_date?: string | null
          name?: string
          notes?: string | null
          organisation?: string | null
          phone?: string | null
          relationship?: string
          updated_at?: string
        }
        Relationships: []
      }
      settings_versions: {
        Row: {
          accountant_may_approve_invoices: boolean
          accounts_email: string
          address: string | null
          bonus_base: string | null
          bonus_eligibility: string | null
          bonus_payment_month: number
          bonus_prorated: boolean
          client_wht_base: string
          company_email: string | null
          company_phone: string | null
          company_website: string | null
          created_at: string
          created_by: string | null
          default_billable_hours: number
          desired_cash_buffer: number
          director_receipt_flag_days: number
          effective_from: string
          fee_target_mode: string
          financial_year_end_month: number
          id: string
          invoice_payment_details: string | null
          invoice_terms_days: number
          leave_year_start_month: number
          max_carry_over_days: number | null
          max_open_advances: number
          monthly_fee_target: number
          notes: string | null
          overhead_share: number
          payment_bank_account_name: string | null
          payment_bank_account_number: string | null
          payment_bank_branch: string | null
          payment_bank_name: string | null
          payment_momo_account_name: string | null
          payment_momo_network: string | null
          payment_momo_note: string | null
          payment_momo_number: string | null
          payroll_line_tolerance: number
          payroll_total_tolerance: number
          pf_employee_rate: number
          pf_employer_rate: number
          registered_name: string
          reported_payment_flag_days: number
          running_cost_override: number | null
          ssnit_employee_rate: number
          ssnit_employer_rate: number
          ssnit_tier1_rate: number
          ssnit_tier2_rate: number
          target_margin: number
          tier2_trustee: string | null
          timesheet_lead_days: number
          timesheet_self_days: number
          tin: string | null
          vat_number: string | null
          wht_certificate_flag_days: number
        }
        Insert: {
          accountant_may_approve_invoices?: boolean
          accounts_email?: string
          address?: string | null
          bonus_base?: string | null
          bonus_eligibility?: string | null
          bonus_payment_month?: number
          bonus_prorated?: boolean
          client_wht_base?: string
          company_email?: string | null
          company_phone?: string | null
          company_website?: string | null
          created_at?: string
          created_by?: string | null
          default_billable_hours?: number
          desired_cash_buffer?: number
          director_receipt_flag_days?: number
          effective_from: string
          fee_target_mode?: string
          financial_year_end_month?: number
          id?: string
          invoice_payment_details?: string | null
          invoice_terms_days?: number
          leave_year_start_month?: number
          max_carry_over_days?: number | null
          max_open_advances?: number
          monthly_fee_target?: number
          notes?: string | null
          overhead_share?: number
          payment_bank_account_name?: string | null
          payment_bank_account_number?: string | null
          payment_bank_branch?: string | null
          payment_bank_name?: string | null
          payment_momo_account_name?: string | null
          payment_momo_network?: string | null
          payment_momo_note?: string | null
          payment_momo_number?: string | null
          payroll_line_tolerance?: number
          payroll_total_tolerance?: number
          pf_employee_rate?: number
          pf_employer_rate?: number
          registered_name?: string
          reported_payment_flag_days?: number
          running_cost_override?: number | null
          ssnit_employee_rate?: number
          ssnit_employer_rate?: number
          ssnit_tier1_rate?: number
          ssnit_tier2_rate?: number
          target_margin?: number
          tier2_trustee?: string | null
          timesheet_lead_days?: number
          timesheet_self_days?: number
          tin?: string | null
          vat_number?: string | null
          wht_certificate_flag_days?: number
        }
        Update: {
          accountant_may_approve_invoices?: boolean
          accounts_email?: string
          address?: string | null
          bonus_base?: string | null
          bonus_eligibility?: string | null
          bonus_payment_month?: number
          bonus_prorated?: boolean
          client_wht_base?: string
          company_email?: string | null
          company_phone?: string | null
          company_website?: string | null
          created_at?: string
          created_by?: string | null
          default_billable_hours?: number
          desired_cash_buffer?: number
          director_receipt_flag_days?: number
          effective_from?: string
          fee_target_mode?: string
          financial_year_end_month?: number
          id?: string
          invoice_payment_details?: string | null
          invoice_terms_days?: number
          leave_year_start_month?: number
          max_carry_over_days?: number | null
          max_open_advances?: number
          monthly_fee_target?: number
          notes?: string | null
          overhead_share?: number
          payment_bank_account_name?: string | null
          payment_bank_account_number?: string | null
          payment_bank_branch?: string | null
          payment_bank_name?: string | null
          payment_momo_account_name?: string | null
          payment_momo_network?: string | null
          payment_momo_note?: string | null
          payment_momo_number?: string | null
          payroll_line_tolerance?: number
          payroll_total_tolerance?: number
          pf_employee_rate?: number
          pf_employer_rate?: number
          registered_name?: string
          reported_payment_flag_days?: number
          running_cost_override?: number | null
          ssnit_employee_rate?: number
          ssnit_employer_rate?: number
          ssnit_tier1_rate?: number
          ssnit_tier2_rate?: number
          target_margin?: number
          tier2_trustee?: string | null
          timesheet_lead_days?: number
          timesheet_self_days?: number
          tin?: string | null
          vat_number?: string | null
          wht_certificate_flag_days?: number
        }
        Relationships: []
      }
      staff: {
        Row: {
          approver_staff_id: string | null
          billable_default: boolean
          budget_role_id: string
          created_at: string
          email: string | null
          end_date: string | null
          full_name: string
          id: string
          is_active: boolean
          is_national_service: boolean
          job_title: string
          monthly_billable_target: number
          start_date: string
          updated_at: string
        }
        Insert: {
          approver_staff_id?: string | null
          billable_default?: boolean
          budget_role_id: string
          created_at?: string
          email?: string | null
          end_date?: string | null
          full_name: string
          id?: string
          is_active?: boolean
          is_national_service?: boolean
          job_title: string
          monthly_billable_target?: number
          start_date: string
          updated_at?: string
        }
        Update: {
          approver_staff_id?: string | null
          billable_default?: boolean
          budget_role_id?: string
          created_at?: string
          email?: string | null
          end_date?: string | null
          full_name?: string
          id?: string
          is_active?: boolean
          is_national_service?: boolean
          job_title?: string
          monthly_billable_target?: number
          start_date?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "staff_approver_staff_id_fkey"
            columns: ["approver_staff_id"]
            isOneToOne: false
            referencedRelation: "staff"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "staff_budget_role_id_fkey"
            columns: ["budget_role_id"]
            isOneToOne: false
            referencedRelation: "budget_roles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "staff_budget_role_id_fkey"
            columns: ["budget_role_id"]
            isOneToOne: false
            referencedRelation: "job_hours_vs_budget"
            referencedColumns: ["budget_role_id"]
          },
        ]
      }
      staff_cost_history: {
        Row: {
          basic_pay: number | null
          created_at: string
          created_by: string | null
          effective_from: string
          id: string
          monthly_cost: number
          notes: string | null
          source: string
          staff_id: string
        }
        Insert: {
          basic_pay?: number | null
          created_at?: string
          created_by?: string | null
          effective_from: string
          id?: string
          monthly_cost: number
          notes?: string | null
          source?: string
          staff_id: string
        }
        Update: {
          basic_pay?: number | null
          created_at?: string
          created_by?: string | null
          effective_from?: string
          id?: string
          monthly_cost?: number
          notes?: string | null
          source?: string
          staff_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "staff_cost_history_staff_id_fkey"
            columns: ["staff_id"]
            isOneToOne: false
            referencedRelation: "staff"
            referencedColumns: ["id"]
          },
        ]
      }
      staff_loan_repayments: {
        Row: {
          account_id: string | null
          amount: number
          company_id: string
          created_at: string
          created_by: string | null
          id: string
          loan_id: string
          method: string
          payroll_line_id: string | null
          query_note: string | null
          reference: string | null
          repayment_date: string
          review_status: Database["public"]["Enums"]["review_status"]
          reviewed_at: string | null
          reviewed_by: string | null
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          account_id?: string | null
          amount: number
          company_id?: string
          created_at?: string
          created_by?: string | null
          id?: string
          loan_id: string
          method: string
          payroll_line_id?: string | null
          query_note?: string | null
          reference?: string | null
          repayment_date: string
          review_status?: Database["public"]["Enums"]["review_status"]
          reviewed_at?: string | null
          reviewed_by?: string | null
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          account_id?: string | null
          amount?: number
          company_id?: string
          created_at?: string
          created_by?: string | null
          id?: string
          loan_id?: string
          method?: string
          payroll_line_id?: string | null
          query_note?: string | null
          reference?: string | null
          repayment_date?: string
          review_status?: Database["public"]["Enums"]["review_status"]
          reviewed_at?: string | null
          reviewed_by?: string | null
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "loan_repayments_payroll_fk"
            columns: ["payroll_line_id"]
            isOneToOne: false
            referencedRelation: "payroll_lines"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "staff_loan_repayments_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "account_balances"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "staff_loan_repayments_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "account_picker"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "staff_loan_repayments_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "staff_loan_repayments_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "staff_loan_repayments_loan_id_fkey"
            columns: ["loan_id"]
            isOneToOne: false
            referencedRelation: "staff_loan_picker"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "staff_loan_repayments_loan_id_fkey"
            columns: ["loan_id"]
            isOneToOne: false
            referencedRelation: "staff_loan_warnings"
            referencedColumns: ["loan_id"]
          },
          {
            foreignKeyName: "staff_loan_repayments_loan_id_fkey"
            columns: ["loan_id"]
            isOneToOne: false
            referencedRelation: "staff_loans"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "staff_loan_repayments_reviewed_by_fkey"
            columns: ["reviewed_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "staff_loan_repayments_reviewed_by_fkey"
            columns: ["reviewed_by"]
            isOneToOne: false
            referencedRelation: "user_directory"
            referencedColumns: ["user_id"]
          },
        ]
      }
      staff_loans: {
        Row: {
          account_id: string | null
          amount: number
          approved_at: string | null
          approved_by: string | null
          attachment_path: string | null
          cleared_at: string | null
          company_id: string
          created_at: string
          created_by: string | null
          currency: string
          first_deduction_month: string | null
          fx_rate: number
          id: string
          method: string | null
          monthly_instalment: number
          notes: string | null
          paid_at: string | null
          paid_by: string | null
          payment_date: string | null
          prepared_by: string | null
          purpose: string | null
          query_note: string | null
          reference: string | null
          review_status: Database["public"]["Enums"]["review_status"]
          reviewed_at: string | null
          reviewed_by: string | null
          staff_id: string
          status: Database["public"]["Enums"]["payout_status"]
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          account_id?: string | null
          amount: number
          approved_at?: string | null
          approved_by?: string | null
          attachment_path?: string | null
          cleared_at?: string | null
          company_id?: string
          created_at?: string
          created_by?: string | null
          currency?: string
          first_deduction_month?: string | null
          fx_rate?: number
          id?: string
          method?: string | null
          monthly_instalment: number
          notes?: string | null
          paid_at?: string | null
          paid_by?: string | null
          payment_date?: string | null
          prepared_by?: string | null
          purpose?: string | null
          query_note?: string | null
          reference?: string | null
          review_status?: Database["public"]["Enums"]["review_status"]
          reviewed_at?: string | null
          reviewed_by?: string | null
          staff_id: string
          status?: Database["public"]["Enums"]["payout_status"]
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          account_id?: string | null
          amount?: number
          approved_at?: string | null
          approved_by?: string | null
          attachment_path?: string | null
          cleared_at?: string | null
          company_id?: string
          created_at?: string
          created_by?: string | null
          currency?: string
          first_deduction_month?: string | null
          fx_rate?: number
          id?: string
          method?: string | null
          monthly_instalment?: number
          notes?: string | null
          paid_at?: string | null
          paid_by?: string | null
          payment_date?: string | null
          prepared_by?: string | null
          purpose?: string | null
          query_note?: string | null
          reference?: string | null
          review_status?: Database["public"]["Enums"]["review_status"]
          reviewed_at?: string | null
          reviewed_by?: string | null
          staff_id?: string
          status?: Database["public"]["Enums"]["payout_status"]
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "staff_loans_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "account_balances"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "staff_loans_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "account_picker"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "staff_loans_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "staff_loans_approved_by_fkey"
            columns: ["approved_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "staff_loans_approved_by_fkey"
            columns: ["approved_by"]
            isOneToOne: false
            referencedRelation: "user_directory"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "staff_loans_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "staff_loans_paid_by_fkey"
            columns: ["paid_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "staff_loans_paid_by_fkey"
            columns: ["paid_by"]
            isOneToOne: false
            referencedRelation: "user_directory"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "staff_loans_prepared_by_fkey"
            columns: ["prepared_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "staff_loans_prepared_by_fkey"
            columns: ["prepared_by"]
            isOneToOne: false
            referencedRelation: "user_directory"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "staff_loans_reviewed_by_fkey"
            columns: ["reviewed_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "staff_loans_reviewed_by_fkey"
            columns: ["reviewed_by"]
            isOneToOne: false
            referencedRelation: "user_directory"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "staff_loans_staff_id_fkey"
            columns: ["staff_id"]
            isOneToOne: false
            referencedRelation: "staff"
            referencedColumns: ["id"]
          },
        ]
      }
      staff_payments: {
        Row: {
          account_id: string | null
          amount: number
          approved_at: string | null
          approved_by: string | null
          attachment_path: string | null
          company_id: string
          created_at: string
          created_by: string | null
          currency: string
          fx_rate: number
          id: string
          is_to_owner: boolean
          kind: string
          method: string | null
          notes: string | null
          paid_at: string | null
          paid_by: string | null
          payment_date: string | null
          prepared_by: string | null
          query_note: string | null
          reference: string | null
          review_status: Database["public"]["Enums"]["review_status"]
          reviewed_at: string | null
          reviewed_by: string | null
          staff_id: string
          status: Database["public"]["Enums"]["payout_status"]
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          account_id?: string | null
          amount?: number
          approved_at?: string | null
          approved_by?: string | null
          attachment_path?: string | null
          company_id?: string
          created_at?: string
          created_by?: string | null
          currency?: string
          fx_rate?: number
          id?: string
          is_to_owner?: boolean
          kind?: string
          method?: string | null
          notes?: string | null
          paid_at?: string | null
          paid_by?: string | null
          payment_date?: string | null
          prepared_by?: string | null
          query_note?: string | null
          reference?: string | null
          review_status?: Database["public"]["Enums"]["review_status"]
          reviewed_at?: string | null
          reviewed_by?: string | null
          staff_id: string
          status?: Database["public"]["Enums"]["payout_status"]
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          account_id?: string | null
          amount?: number
          approved_at?: string | null
          approved_by?: string | null
          attachment_path?: string | null
          company_id?: string
          created_at?: string
          created_by?: string | null
          currency?: string
          fx_rate?: number
          id?: string
          is_to_owner?: boolean
          kind?: string
          method?: string | null
          notes?: string | null
          paid_at?: string | null
          paid_by?: string | null
          payment_date?: string | null
          prepared_by?: string | null
          query_note?: string | null
          reference?: string | null
          review_status?: Database["public"]["Enums"]["review_status"]
          reviewed_at?: string | null
          reviewed_by?: string | null
          staff_id?: string
          status?: Database["public"]["Enums"]["payout_status"]
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "staff_payments_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "account_balances"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "staff_payments_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "account_picker"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "staff_payments_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "staff_payments_approved_by_fkey"
            columns: ["approved_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "staff_payments_approved_by_fkey"
            columns: ["approved_by"]
            isOneToOne: false
            referencedRelation: "user_directory"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "staff_payments_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "staff_payments_paid_by_fkey"
            columns: ["paid_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "staff_payments_paid_by_fkey"
            columns: ["paid_by"]
            isOneToOne: false
            referencedRelation: "user_directory"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "staff_payments_prepared_by_fkey"
            columns: ["prepared_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "staff_payments_prepared_by_fkey"
            columns: ["prepared_by"]
            isOneToOne: false
            referencedRelation: "user_directory"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "staff_payments_reviewed_by_fkey"
            columns: ["reviewed_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "staff_payments_reviewed_by_fkey"
            columns: ["reviewed_by"]
            isOneToOne: false
            referencedRelation: "user_directory"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "staff_payments_staff_id_fkey"
            columns: ["staff_id"]
            isOneToOne: false
            referencedRelation: "staff"
            referencedColumns: ["id"]
          },
        ]
      }
      staff_private: {
        Row: {
          ssnit_number: string | null
          staff_id: string
          tin: string | null
          updated_at: string
        }
        Insert: {
          ssnit_number?: string | null
          staff_id: string
          tin?: string | null
          updated_at?: string
        }
        Update: {
          ssnit_number?: string | null
          staff_id?: string
          tin?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "staff_private_staff_id_fkey"
            columns: ["staff_id"]
            isOneToOne: true
            referencedRelation: "staff"
            referencedColumns: ["id"]
          },
        ]
      }
      statement_imports: {
        Row: {
          account_id: string
          closing_balance: number
          file_path: string | null
          id: string
          opening_balance: number | null
          period_end: string
          period_start: string
          source_format: string | null
          uploaded_at: string
          uploaded_by: string | null
        }
        Insert: {
          account_id: string
          closing_balance: number
          file_path?: string | null
          id?: string
          opening_balance?: number | null
          period_end: string
          period_start: string
          source_format?: string | null
          uploaded_at?: string
          uploaded_by?: string | null
        }
        Update: {
          account_id?: string
          closing_balance?: number
          file_path?: string | null
          id?: string
          opening_balance?: number | null
          period_end?: string
          period_start?: string
          source_format?: string | null
          uploaded_at?: string
          uploaded_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "statement_imports_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "account_balances"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "statement_imports_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "account_picker"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "statement_imports_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "statement_imports_uploaded_by_fkey"
            columns: ["uploaded_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "statement_imports_uploaded_by_fkey"
            columns: ["uploaded_by"]
            isOneToOne: false
            referencedRelation: "user_directory"
            referencedColumns: ["user_id"]
          },
        ]
      }
      statement_lines: {
        Row: {
          amount: number
          description: string | null
          explanation: string | null
          id: string
          import_id: string
          line_date: string
          matched_at: string | null
          matched_by: string | null
          matched_source_id: string | null
          matched_source_type: string | null
          reference: string | null
          running_balance: number | null
          status: string
        }
        Insert: {
          amount: number
          description?: string | null
          explanation?: string | null
          id?: string
          import_id: string
          line_date: string
          matched_at?: string | null
          matched_by?: string | null
          matched_source_id?: string | null
          matched_source_type?: string | null
          reference?: string | null
          running_balance?: number | null
          status?: string
        }
        Update: {
          amount?: number
          description?: string | null
          explanation?: string | null
          id?: string
          import_id?: string
          line_date?: string
          matched_at?: string | null
          matched_by?: string | null
          matched_source_id?: string | null
          matched_source_type?: string | null
          reference?: string | null
          running_balance?: number | null
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "statement_lines_import_id_fkey"
            columns: ["import_id"]
            isOneToOne: false
            referencedRelation: "statement_imports"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "statement_lines_matched_by_fkey"
            columns: ["matched_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "statement_lines_matched_by_fkey"
            columns: ["matched_by"]
            isOneToOne: false
            referencedRelation: "user_directory"
            referencedColumns: ["user_id"]
          },
        ]
      }
      statutory_due_rules: {
        Row: {
          day_of_month: number | null
          label: string
          months_after: number | null
          notes: string | null
          payee: string | null
          rule_kind: string
          type: string
          updated_at: string
        }
        Insert: {
          day_of_month?: number | null
          label: string
          months_after?: number | null
          notes?: string | null
          payee?: string | null
          rule_kind: string
          type: string
          updated_at?: string
        }
        Update: {
          day_of_month?: number | null
          label?: string
          months_after?: number | null
          notes?: string | null
          payee?: string | null
          rule_kind?: string
          type?: string
          updated_at?: string
        }
        Relationships: []
      }
      statutory_lines: {
        Row: {
          amount_due: number
          auto_key: string | null
          company_id: string
          created_at: string
          created_by: string | null
          due_date: string | null
          id: string
          is_opening_arrears: boolean
          notes: string | null
          payee: string | null
          period_end: string | null
          period_start: string | null
          planned_payment_date: string | null
          source_id: string | null
          source_type: string | null
          type: string
          updated_at: string
        }
        Insert: {
          amount_due: number
          auto_key?: string | null
          company_id?: string
          created_at?: string
          created_by?: string | null
          due_date?: string | null
          id?: string
          is_opening_arrears?: boolean
          notes?: string | null
          payee?: string | null
          period_end?: string | null
          period_start?: string | null
          planned_payment_date?: string | null
          source_id?: string | null
          source_type?: string | null
          type: string
          updated_at?: string
        }
        Update: {
          amount_due?: number
          auto_key?: string | null
          company_id?: string
          created_at?: string
          created_by?: string | null
          due_date?: string | null
          id?: string
          is_opening_arrears?: boolean
          notes?: string | null
          payee?: string | null
          period_end?: string | null
          period_start?: string | null
          planned_payment_date?: string | null
          source_id?: string | null
          source_type?: string | null
          type?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "statutory_lines_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "statutory_lines_type_fkey"
            columns: ["type"]
            isOneToOne: false
            referencedRelation: "statutory_due_rules"
            referencedColumns: ["type"]
          },
        ]
      }
      statutory_payments: {
        Row: {
          account_id: string | null
          amount: number
          approved_at: string | null
          approved_by: string | null
          attachment_path: string | null
          company_id: string
          created_at: string
          created_by: string | null
          currency: string
          fx_rate: number
          id: string
          method: string | null
          notes: string | null
          paid_at: string | null
          paid_by: string | null
          payment_date: string | null
          prepared_by: string | null
          query_note: string | null
          receipt_path: string | null
          reference: string | null
          review_status: Database["public"]["Enums"]["review_status"]
          reviewed_at: string | null
          reviewed_by: string | null
          status: Database["public"]["Enums"]["payout_status"]
          statutory_line_id: string
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          account_id?: string | null
          amount: number
          approved_at?: string | null
          approved_by?: string | null
          attachment_path?: string | null
          company_id?: string
          created_at?: string
          created_by?: string | null
          currency?: string
          fx_rate?: number
          id?: string
          method?: string | null
          notes?: string | null
          paid_at?: string | null
          paid_by?: string | null
          payment_date?: string | null
          prepared_by?: string | null
          query_note?: string | null
          receipt_path?: string | null
          reference?: string | null
          review_status?: Database["public"]["Enums"]["review_status"]
          reviewed_at?: string | null
          reviewed_by?: string | null
          status?: Database["public"]["Enums"]["payout_status"]
          statutory_line_id: string
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          account_id?: string | null
          amount?: number
          approved_at?: string | null
          approved_by?: string | null
          attachment_path?: string | null
          company_id?: string
          created_at?: string
          created_by?: string | null
          currency?: string
          fx_rate?: number
          id?: string
          method?: string | null
          notes?: string | null
          paid_at?: string | null
          paid_by?: string | null
          payment_date?: string | null
          prepared_by?: string | null
          query_note?: string | null
          receipt_path?: string | null
          reference?: string | null
          review_status?: Database["public"]["Enums"]["review_status"]
          reviewed_at?: string | null
          reviewed_by?: string | null
          status?: Database["public"]["Enums"]["payout_status"]
          statutory_line_id?: string
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "statutory_payments_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "account_balances"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "statutory_payments_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "account_picker"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "statutory_payments_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "statutory_payments_approved_by_fkey"
            columns: ["approved_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "statutory_payments_approved_by_fkey"
            columns: ["approved_by"]
            isOneToOne: false
            referencedRelation: "user_directory"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "statutory_payments_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "statutory_payments_paid_by_fkey"
            columns: ["paid_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "statutory_payments_paid_by_fkey"
            columns: ["paid_by"]
            isOneToOne: false
            referencedRelation: "user_directory"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "statutory_payments_prepared_by_fkey"
            columns: ["prepared_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "statutory_payments_prepared_by_fkey"
            columns: ["prepared_by"]
            isOneToOne: false
            referencedRelation: "user_directory"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "statutory_payments_reviewed_by_fkey"
            columns: ["reviewed_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "statutory_payments_reviewed_by_fkey"
            columns: ["reviewed_by"]
            isOneToOne: false
            referencedRelation: "user_directory"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "statutory_payments_statutory_line_id_fkey"
            columns: ["statutory_line_id"]
            isOneToOne: false
            referencedRelation: "statutory_ledger"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "statutory_payments_statutory_line_id_fkey"
            columns: ["statutory_line_id"]
            isOneToOne: false
            referencedRelation: "statutory_lines"
            referencedColumns: ["id"]
          },
        ]
      }
      statutory_plan_instalments: {
        Row: {
          amount: number
          created_at: string
          created_by: string | null
          due_on: string
          id: string
          notes: string | null
          statutory_line_id: string
        }
        Insert: {
          amount: number
          created_at?: string
          created_by?: string | null
          due_on: string
          id?: string
          notes?: string | null
          statutory_line_id: string
        }
        Update: {
          amount?: number
          created_at?: string
          created_by?: string | null
          due_on?: string
          id?: string
          notes?: string | null
          statutory_line_id?: string
        }
        Relationships: []
      }
      supplier_identifiers: {
        Row: {
          ghana_card: string | null
          supplier_id: string
          tin: string | null
          updated_at: string
        }
        Insert: {
          ghana_card?: string | null
          supplier_id: string
          tin?: string | null
          updated_at?: string
        }
        Update: {
          ghana_card?: string | null
          supplier_id?: string
          tin?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "supplier_identifiers_supplier_id_fkey"
            columns: ["supplier_id"]
            isOneToOne: true
            referencedRelation: "suppliers"
            referencedColumns: ["id"]
          },
        ]
      }
      suppliers: {
        Row: {
          company_id: string
          created_at: string
          created_by: string | null
          id: string
          is_active: boolean
          name: string
          notes: string | null
          type: string
          updated_at: string
          wht_category: string | null
        }
        Insert: {
          company_id?: string
          created_at?: string
          created_by?: string | null
          id?: string
          is_active?: boolean
          name: string
          notes?: string | null
          type?: string
          updated_at?: string
          wht_category?: string | null
        }
        Update: {
          company_id?: string
          created_at?: string
          created_by?: string | null
          id?: string
          is_active?: boolean
          name?: string
          notes?: string | null
          type?: string
          updated_at?: string
          wht_category?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "suppliers_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      tax_code_components: {
        Row: {
          basis: string
          id: string
          is_vat: boolean
          name: string
          rate: number
          recoverable: boolean
          seq: number
          version_id: string
        }
        Insert: {
          basis?: string
          id?: string
          is_vat?: boolean
          name: string
          rate: number
          recoverable?: boolean
          seq: number
          version_id: string
        }
        Update: {
          basis?: string
          id?: string
          is_vat?: boolean
          name?: string
          rate?: number
          recoverable?: boolean
          seq?: number
          version_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "tax_code_components_version_id_fkey"
            columns: ["version_id"]
            isOneToOne: false
            referencedRelation: "tax_code_versions"
            referencedColumns: ["id"]
          },
        ]
      }
      tax_code_versions: {
        Row: {
          confirmed_at: string | null
          confirmed_by: string | null
          created_at: string
          effective_from: string
          id: string
          notes: string | null
          tax_code_id: string
          vat_withholding_rate: number
        }
        Insert: {
          confirmed_at?: string | null
          confirmed_by?: string | null
          created_at?: string
          effective_from: string
          id?: string
          notes?: string | null
          tax_code_id: string
          vat_withholding_rate?: number
        }
        Update: {
          confirmed_at?: string | null
          confirmed_by?: string | null
          created_at?: string
          effective_from?: string
          id?: string
          notes?: string | null
          tax_code_id?: string
          vat_withholding_rate?: number
        }
        Relationships: [
          {
            foreignKeyName: "tax_code_versions_confirmed_by_fkey"
            columns: ["confirmed_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "tax_code_versions_confirmed_by_fkey"
            columns: ["confirmed_by"]
            isOneToOne: false
            referencedRelation: "user_directory"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "tax_code_versions_tax_code_id_fkey"
            columns: ["tax_code_id"]
            isOneToOne: false
            referencedRelation: "tax_codes"
            referencedColumns: ["id"]
          },
        ]
      }
      tax_codes: {
        Row: {
          created_at: string
          id: string
          is_active: boolean
          kind: string
          name: string
        }
        Insert: {
          created_at?: string
          id?: string
          is_active?: boolean
          kind: string
          name: string
        }
        Update: {
          created_at?: string
          id?: string
          is_active?: boolean
          kind?: string
          name?: string
        }
        Relationships: []
      }
      tax_credit_applications: {
        Row: {
          amount: number
          applied_on: string
          created_at: string
          created_by: string | null
          credit_id: string
          gra_reference: string | null
          id: string
          kind: string
          notes: string | null
          statutory_line_id: string
        }
        Insert: {
          amount: number
          applied_on?: string
          created_at?: string
          created_by?: string | null
          credit_id: string
          gra_reference?: string | null
          id?: string
          kind: string
          notes?: string | null
          statutory_line_id: string
        }
        Update: {
          amount?: number
          applied_on?: string
          created_at?: string
          created_by?: string | null
          credit_id?: string
          gra_reference?: string | null
          id?: string
          kind?: string
          notes?: string | null
          statutory_line_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "tax_credit_applications_credit_id_fkey"
            columns: ["credit_id"]
            isOneToOne: false
            referencedRelation: "tax_credits"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tax_credit_applications_statutory_line_id_fkey"
            columns: ["statutory_line_id"]
            isOneToOne: false
            referencedRelation: "statutory_lines"
            referencedColumns: ["id"]
          },
        ]
      }
      tax_credits: {
        Row: {
          amount: number
          as_at: string
          attachment_path: string | null
          authority: string
          auto_offset_type: string | null
          company_id: string
          created_at: string
          created_by: string | null
          description: string
          id: string
          notes: string | null
          reference: string | null
          tax_type: string
          updated_at: string
        }
        Insert: {
          amount: number
          as_at: string
          attachment_path?: string | null
          authority?: string
          auto_offset_type?: string | null
          company_id?: string
          created_at?: string
          created_by?: string | null
          description: string
          id?: string
          notes?: string | null
          reference?: string | null
          tax_type?: string
          updated_at?: string
        }
        Update: {
          amount?: number
          as_at?: string
          attachment_path?: string | null
          authority?: string
          auto_offset_type?: string | null
          company_id?: string
          created_at?: string
          created_by?: string | null
          description?: string
          id?: string
          notes?: string | null
          reference?: string | null
          tax_type?: string
          updated_at?: string
        }
        Relationships: []
      }
      timesheet_entries: {
        Row: {
          approved_at: string | null
          approved_by: string | null
          billable: boolean
          budget_role_id: string | null
          category: string
          client_ref: string | null
          created_at: string
          description: string | null
          entered_by: string | null
          hours: number
          id: string
          is_late_entry: boolean
          job_id: string | null
          late_reason: string | null
          leave_request_id: string | null
          return_note: string | null
          staff_id: string
          status: string
          updated_at: string
          work_date: string
        }
        Insert: {
          approved_at?: string | null
          approved_by?: string | null
          billable?: boolean
          budget_role_id?: string | null
          category: string
          client_ref?: string | null
          created_at?: string
          description?: string | null
          entered_by?: string | null
          hours: number
          id?: string
          is_late_entry?: boolean
          job_id?: string | null
          late_reason?: string | null
          leave_request_id?: string | null
          return_note?: string | null
          staff_id: string
          status?: string
          updated_at?: string
          work_date: string
        }
        Update: {
          approved_at?: string | null
          approved_by?: string | null
          billable?: boolean
          budget_role_id?: string | null
          category?: string
          client_ref?: string | null
          created_at?: string
          description?: string | null
          entered_by?: string | null
          hours?: number
          id?: string
          is_late_entry?: boolean
          job_id?: string | null
          late_reason?: string | null
          leave_request_id?: string | null
          return_note?: string | null
          staff_id?: string
          status?: string
          updated_at?: string
          work_date?: string
        }
        Relationships: [
          {
            foreignKeyName: "timesheet_entries_approved_by_fkey"
            columns: ["approved_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "timesheet_entries_approved_by_fkey"
            columns: ["approved_by"]
            isOneToOne: false
            referencedRelation: "user_directory"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "timesheet_entries_budget_role_id_fkey"
            columns: ["budget_role_id"]
            isOneToOne: false
            referencedRelation: "budget_roles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "timesheet_entries_budget_role_id_fkey"
            columns: ["budget_role_id"]
            isOneToOne: false
            referencedRelation: "job_hours_vs_budget"
            referencedColumns: ["budget_role_id"]
          },
          {
            foreignKeyName: "timesheet_entries_entered_by_fkey"
            columns: ["entered_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "timesheet_entries_entered_by_fkey"
            columns: ["entered_by"]
            isOneToOne: false
            referencedRelation: "user_directory"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "timesheet_entries_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "job_hours_vs_budget"
            referencedColumns: ["job_id"]
          },
          {
            foreignKeyName: "timesheet_entries_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "job_milestone_check"
            referencedColumns: ["job_id"]
          },
          {
            foreignKeyName: "timesheet_entries_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "job_money_status"
            referencedColumns: ["job_id"]
          },
          {
            foreignKeyName: "timesheet_entries_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "jobs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "timesheet_entries_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "jobs_flagged"
            referencedColumns: ["job_id"]
          },
          {
            foreignKeyName: "timesheet_entries_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "my_jobs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "timesheet_entries_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "retention_by_job"
            referencedColumns: ["job_id"]
          },
          {
            foreignKeyName: "timesheet_entries_leave_request_id_fkey"
            columns: ["leave_request_id"]
            isOneToOne: false
            referencedRelation: "leave_calendar"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "timesheet_entries_leave_request_id_fkey"
            columns: ["leave_request_id"]
            isOneToOne: false
            referencedRelation: "leave_requests"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "timesheet_entries_staff_id_fkey"
            columns: ["staff_id"]
            isOneToOne: false
            referencedRelation: "staff"
            referencedColumns: ["id"]
          },
        ]
      }
      timesheet_rate_snapshots: {
        Row: {
          charge_out_rate: number | null
          cost_rate: number | null
          entry_id: string
          frozen_at: string
        }
        Insert: {
          charge_out_rate?: number | null
          cost_rate?: number | null
          entry_id: string
          frozen_at?: string
        }
        Update: {
          charge_out_rate?: number | null
          cost_rate?: number | null
          entry_id?: string
          frozen_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "timesheet_rate_snapshots_entry_id_fkey"
            columns: ["entry_id"]
            isOneToOne: true
            referencedRelation: "timesheet_entries"
            referencedColumns: ["id"]
          },
        ]
      }
      transfers: {
        Row: {
          amount: number
          attachment_path: string | null
          company_id: string
          created_at: string
          created_by: string | null
          currency: string
          from_account_id: string | null
          from_director_id: string | null
          fx_rate: number
          id: string
          query_note: string | null
          reason: string | null
          reference: string | null
          review_status: Database["public"]["Enums"]["review_status"]
          reviewed_at: string | null
          reviewed_by: string | null
          to_account_id: string
          transfer_date: string
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          amount: number
          attachment_path?: string | null
          company_id?: string
          created_at?: string
          created_by?: string | null
          currency?: string
          from_account_id?: string | null
          from_director_id?: string | null
          fx_rate?: number
          id?: string
          query_note?: string | null
          reason?: string | null
          reference?: string | null
          review_status?: Database["public"]["Enums"]["review_status"]
          reviewed_at?: string | null
          reviewed_by?: string | null
          to_account_id: string
          transfer_date: string
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          amount?: number
          attachment_path?: string | null
          company_id?: string
          created_at?: string
          created_by?: string | null
          currency?: string
          from_account_id?: string | null
          from_director_id?: string | null
          fx_rate?: number
          id?: string
          query_note?: string | null
          reason?: string | null
          reference?: string | null
          review_status?: Database["public"]["Enums"]["review_status"]
          reviewed_at?: string | null
          reviewed_by?: string | null
          to_account_id?: string
          transfer_date?: string
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "transfers_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "transfers_from_account_id_fkey"
            columns: ["from_account_id"]
            isOneToOne: false
            referencedRelation: "account_balances"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "transfers_from_account_id_fkey"
            columns: ["from_account_id"]
            isOneToOne: false
            referencedRelation: "account_picker"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "transfers_from_account_id_fkey"
            columns: ["from_account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "transfers_from_director_id_fkey"
            columns: ["from_director_id"]
            isOneToOne: false
            referencedRelation: "director_balances"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "transfers_from_director_id_fkey"
            columns: ["from_director_id"]
            isOneToOne: false
            referencedRelation: "directors"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "transfers_from_director_id_fkey"
            columns: ["from_director_id"]
            isOneToOne: false
            referencedRelation: "user_directory"
            referencedColumns: ["director_id"]
          },
          {
            foreignKeyName: "transfers_reviewed_by_fkey"
            columns: ["reviewed_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "transfers_reviewed_by_fkey"
            columns: ["reviewed_by"]
            isOneToOne: false
            referencedRelation: "user_directory"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "transfers_to_account_id_fkey"
            columns: ["to_account_id"]
            isOneToOne: false
            referencedRelation: "account_balances"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "transfers_to_account_id_fkey"
            columns: ["to_account_id"]
            isOneToOne: false
            referencedRelation: "account_picker"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "transfers_to_account_id_fkey"
            columns: ["to_account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
        ]
      }
      wht_certificate_receipts: {
        Row: {
          certificate_id: string
          receipt_id: string
        }
        Insert: {
          certificate_id: string
          receipt_id: string
        }
        Update: {
          certificate_id?: string
          receipt_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "wht_certificate_receipts_certificate_id_fkey"
            columns: ["certificate_id"]
            isOneToOne: false
            referencedRelation: "wht_certificates"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "wht_certificate_receipts_receipt_id_fkey"
            columns: ["receipt_id"]
            isOneToOne: true
            referencedRelation: "receipts"
            referencedColumns: ["id"]
          },
        ]
      }
      wht_certificates: {
        Row: {
          amount: number
          certificate_number: string | null
          client_id: string
          created_at: string
          created_by: string | null
          date_received: string | null
          expected_by: string | null
          id: string
          notes: string | null
          scan_path: string | null
          status: string
          updated_at: string
        }
        Insert: {
          amount: number
          certificate_number?: string | null
          client_id: string
          created_at?: string
          created_by?: string | null
          date_received?: string | null
          expected_by?: string | null
          id?: string
          notes?: string | null
          scan_path?: string | null
          status?: string
          updated_at?: string
        }
        Update: {
          amount?: number
          certificate_number?: string | null
          client_id?: string
          created_at?: string
          created_by?: string | null
          date_received?: string | null
          expected_by?: string | null
          id?: string
          notes?: string | null
          scan_path?: string | null
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "wht_certificates_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "wht_certificates_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "retention_by_job"
            referencedColumns: ["client_id"]
          },
        ]
      }
      wht_rates: {
        Row: {
          applies_to: string
          category: string
          created_at: string
          effective_from: string
          id: string
          rate: number
        }
        Insert: {
          applies_to: string
          category: string
          created_at?: string
          effective_from: string
          id?: string
          rate: number
        }
        Update: {
          applies_to?: string
          category?: string
          created_at?: string
          effective_from?: string
          id?: string
          rate?: number
        }
        Relationships: []
      }
    }
    Views: {
      account_balances: {
        Row: {
          calculated_balance: number | null
          id: string | null
          institution: string | null
          is_active: boolean | null
          last_difference: number | null
          last_reconciled_month: string | null
          last_statement_balance: number | null
          last4: string | null
          name: string | null
          purpose: string | null
          type: string | null
        }
        Relationships: []
      }
      account_picker: {
        Row: {
          id: string | null
          name: string | null
          type: string | null
        }
        Insert: {
          id?: string | null
          name?: string | null
          type?: string | null
        }
        Update: {
          id?: string | null
          name?: string | null
          type?: string | null
        }
        Relationships: []
      }
      company_profile: {
        Row: {
          accounts_email: string | null
          address: string | null
          company_email: string | null
          company_phone: string | null
          company_website: string | null
          effective_from: string | null
          invoice_payment_details: string | null
          invoice_terms_days: number | null
          payment_bank_account_name: string | null
          payment_bank_account_number: string | null
          payment_bank_branch: string | null
          payment_bank_name: string | null
          payment_momo_account_name: string | null
          payment_momo_network: string | null
          payment_momo_note: string | null
          payment_momo_number: string | null
          registered_name: string | null
          tin: string | null
          vat_number: string | null
        }
        Insert: {
          accounts_email?: string | null
          address?: string | null
          effective_from?: string | null
          invoice_payment_details?: string | null
          invoice_terms_days?: number | null
          registered_name?: string | null
          tin?: string | null
          vat_number?: string | null
        }
        Update: {
          accounts_email?: string | null
          address?: string | null
          effective_from?: string | null
          invoice_payment_details?: string | null
          invoice_terms_days?: number | null
          registered_name?: string | null
          tin?: string | null
          vat_number?: string | null
        }
        Relationships: []
      }
      director_balances: {
        Row: {
          balance: number | null
          full_name: string | null
          id: string | null
          oldest_client_money_held: string | null
        }
        Insert: {
          balance?: never
          full_name?: string | null
          id?: string | null
          oldest_client_money_held?: never
        }
        Update: {
          balance?: never
          full_name?: string | null
          id?: string | null
          oldest_client_money_held?: never
        }
        Relationships: []
      }
      invoices_to_chase: {
        Row: {
          chase_step: string | null
          client_name: string | null
          days_overdue: number | null
          due_date: string | null
          email: string | null
          id: string | null
          invoice_number: string | null
          outstanding: number | null
          phone: string | null
        }
        Relationships: []
      }
      job_hours_vs_budget: {
        Row: {
          approved_hours: number | null
          budget_hours: number | null
          budget_role: string | null
          budget_role_id: string | null
          job_id: string | null
          job_number: string | null
          logged_hours: number | null
          over_budget: boolean | null
          title: string | null
        }
        Relationships: []
      }
      job_milestone_check: {
        Row: {
          difference: number | null
          fee: number | null
          job_id: string | null
          job_number: string | null
          milestones_total: number | null
        }
        Relationships: []
      }
      job_money_status: {
        Row: {
          billed_due: number | null
          fee: number | null
          invoiced_net: number | null
          job_id: string | null
          job_number: string | null
          money_status: string | null
          settled: number | null
        }
        Relationships: []
      }
      jobs_flagged: {
        Row: {
          delivery_status: string | null
          due_date: string | null
          job_id: string | null
          job_number: string | null
          over_hours_budget: boolean | null
          past_due: boolean | null
          title: string | null
        }
        Insert: {
          delivery_status?: string | null
          due_date?: string | null
          job_id?: string | null
          job_number?: string | null
          over_hours_budget?: never
          past_due?: never
          title?: string | null
        }
        Update: {
          delivery_status?: string | null
          due_date?: string | null
          job_id?: string | null
          job_number?: string | null
          over_hours_budget?: never
          past_due?: never
          title?: string | null
        }
        Relationships: []
      }
      leave_balances: {
        Row: {
          available: number | null
          booked: number | null
          carried_over: number | null
          entitled: number | null
          full_name: string | null
          leave_type: string | null
          leave_type_id: string | null
          leave_year: number | null
          staff_id: string | null
          taken: number | null
        }
        Relationships: [
          {
            foreignKeyName: "leave_entitlements_leave_type_id_fkey"
            columns: ["leave_type_id"]
            isOneToOne: false
            referencedRelation: "leave_types"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "leave_entitlements_staff_id_fkey"
            columns: ["staff_id"]
            isOneToOne: false
            referencedRelation: "staff"
            referencedColumns: ["id"]
          },
        ]
      }
      leave_calendar: {
        Row: {
          end_date: string | null
          full_name: string | null
          id: string | null
          start_date: string | null
        }
        Relationships: []
      }
      my_jobs: {
        Row: {
          client_name: string | null
          delivery_status: string | null
          due_date: string | null
          id: string | null
          job_number: string | null
          percent_complete: number | null
          start_date: string | null
          title: string | null
        }
        Relationships: []
      }
      payroll_cost_changes: {
        Row: {
          basic: number | null
          current_cost: number | null
          full_name: string | null
          payroll_cost: number | null
          period_month: string | null
          run_id: string | null
          staff_id: string | null
        }
        Relationships: [
          {
            foreignKeyName: "payroll_lines_staff_id_fkey"
            columns: ["staff_id"]
            isOneToOne: false
            referencedRelation: "staff"
            referencedColumns: ["id"]
          },
        ]
      }
      ready_to_invoice: {
        Row: {
          amount: number | null
          description: string | null
          item_id: string | null
          item_type: string | null
          job_id: string | null
          job_number: string | null
          job_title: string | null
          ready_since: string | null
        }
        Relationships: []
      }
      receipt_tasks: {
        Row: {
          action_id: string | null
          amount: number | null
          description: string | null
          line_date: string | null
          reference: string | null
          statement_line_id: string | null
          status: string | null
        }
        Relationships: []
      }
      receivables_ageing: {
        Row: {
          bucket: string | null
          client_id: string | null
          client_name: string | null
          days_outstanding: number | null
          due_date: string | null
          id: string | null
          invoice_date: string | null
          invoice_number: string | null
          job_id: string | null
          outstanding: number | null
          status: string | null
        }
        Relationships: [
          {
            foreignKeyName: "invoices_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invoices_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "retention_by_job"
            referencedColumns: ["client_id"]
          },
          {
            foreignKeyName: "invoices_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "job_hours_vs_budget"
            referencedColumns: ["job_id"]
          },
          {
            foreignKeyName: "invoices_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "job_milestone_check"
            referencedColumns: ["job_id"]
          },
          {
            foreignKeyName: "invoices_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "job_money_status"
            referencedColumns: ["job_id"]
          },
          {
            foreignKeyName: "invoices_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "jobs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invoices_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "jobs_flagged"
            referencedColumns: ["job_id"]
          },
          {
            foreignKeyName: "invoices_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "my_jobs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invoices_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "retention_by_job"
            referencedColumns: ["job_id"]
          },
        ]
      }
      retention_by_job: {
        Row: {
          client_id: string | null
          client_name: string | null
          job_id: string | null
          job_number: string | null
          retention_held: number | null
          retention_pct: number | null
          retention_release_date: string | null
          retention_release_terms: string | null
          title: string | null
        }
        Relationships: []
      }
      staff_loan_picker: {
        Row: {
          full_name: string | null
          id: string | null
          loan_date: string | null
          monthly_instalment: number | null
        }
        Relationships: []
      }
      staff_loan_warnings: {
        Row: {
          balance: number | null
          end_date: string | null
          full_name: string | null
          loan_id: string | null
          months_to_clear: number | null
        }
        Relationships: []
      }
      statutory_ledger: {
        Row: {
          amount_due: number | null
          amount_paid: number | null
          credit_applied: number | null
          due_date: string | null
          id: string | null
          is_opening_arrears: boolean | null
          label: string | null
          last_paid_on: string | null
          notes: string | null
          outstanding: number | null
          payee: string | null
          period_end: string | null
          period_start: string | null
          status: string | null
          type: string | null
        }
        Relationships: [
          {
            foreignKeyName: "statutory_lines_type_fkey"
            columns: ["type"]
            isOneToOne: false
            referencedRelation: "statutory_due_rules"
            referencedColumns: ["type"]
          },
        ]
      }
      statutory_plans: {
        Row: {
          first_missed_on: string | null
          instalments: number | null
          missed_count: number | null
          next_amount: number | null
          next_due_on: string | null
          planned_payment_date: string | null
          statutory_line_id: string | null
        }
        Relationships: []
      }
      supplier_bills_open: {
        Row: {
          amount: number | null
          description: string | null
          expense_date: string | null
          id: string | null
          outstanding: number | null
          supplier_id: string | null
          supplier_name: string | null
        }
        Relationships: [
          {
            foreignKeyName: "expenses_supplier_id_fkey"
            columns: ["supplier_id"]
            isOneToOne: false
            referencedRelation: "suppliers"
            referencedColumns: ["id"]
          },
        ]
      }
      tax_credit_balances: {
        Row: {
          amount: number | null
          applied: number | null
          as_at: string | null
          authority: string | null
          auto_offset_type: string | null
          description: string | null
          id: string | null
          notes: string | null
          reference: string | null
          remaining: number | null
          tax_type: string | null
        }
        Relationships: []
      }
      timesheet_charge_out: {
        Row: {
          charge_out_rate: number | null
          entry_id: string | null
        }
        Insert: {
          charge_out_rate?: number | null
          entry_id?: string | null
        }
        Update: {
          charge_out_rate?: number | null
          entry_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "timesheet_rate_snapshots_entry_id_fkey"
            columns: ["entry_id"]
            isOneToOne: true
            referencedRelation: "timesheet_entries"
            referencedColumns: ["id"]
          },
        ]
      }
      user_directory: {
        Row: {
          accepted_invite: boolean | null
          director_id: string | null
          email: string | null
          full_name: string | null
          is_active: boolean | null
          last_sign_in_at: string | null
          role: Database["public"]["Enums"]["app_role"] | null
          staff_id: string | null
          staff_name: string | null
          user_id: string | null
        }
        Relationships: [
          {
            foreignKeyName: "profiles_staff_fk"
            columns: ["staff_id"]
            isOneToOne: true
            referencedRelation: "staff"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Functions: {
      apply_tax_credit: {
        Args: {
          p_amount: number
          p_credit: string
          p_gra_reference: string
          p_line: string
          p_notes?: string
        }
        Returns: string
      }
      accountant_queue: { Args: never; Returns: Json }
      apply_payroll_cost_changes: {
        Args: { p_run: string; p_staff: string[] }
        Returns: number
      }
      close_month: { Args: { p_month: string }; Returns: undefined }
      entries_to_review: {
        Args: { p_month?: string }
        Returns: {
          amount: number
          description: string
          entered_by: string
          entry_date: string
          query_note: string
          record_id: string
          record_type: string
          review_status: string
        }[]
      }
      mark_month_reviewed: { Args: { p_month: string }; Returns: undefined }
      missing_timesheet_days: {
        Args: { p_from: string; p_to?: string }
        Returns: {
          full_name: string
          staff_id: string
          work_date: string
          working_days_elapsed: number
        }[]
      }
      money_panel: { Args: { p_as_of?: string }; Returns: Json }
      month_close_blockers: {
        Args: { p_month: string }
        Returns: {
          description: string
          kind: string
          record_id: string
          record_type: string
        }[]
      }
      monthly_summary: { Args: { p_month: string }; Returns: Json }
      payroll_checks: {
        Args: { p_run: string }
        Returns: {
          code: string
          message: string
          severity: string
          staff_id: string
          staff_name: string
        }[]
      }
      quick_log_payment: {
        Args: {
          p_amount: number
          p_client_id?: string
          p_date?: string
          p_invoice_id?: string
        }
        Returns: string
      }
      reopen_month: {
        Args: { p_month: string; p_reason: string }
        Returns: undefined
      }
      running_cost: {
        Args: { p_as_of?: string }
        Returns: Record<string, unknown>
      }
      save_close_checklist: {
        Args: { p_checklist: Json; p_complete?: boolean; p_month: string }
        Returns: undefined
      }
      set_up_leave_year: { Args: { p_year: number }; Returns: number }
      timesheet_compliance: {
        Args: { p_from: string; p_to?: string }
        Returns: {
          full_name: string
          late_days: number
          missing_days: number
          on_time_days: number
          on_time_pct: number
          staff_id: string
          working_days: number
        }[]
      }
      utilisation: {
        Args: { p_from: string; p_to: string }
        Returns: {
          billable_hours: number
          full_name: string
          month: string
          staff_id: string
          target_hours: number
          utilisation_pct: number
        }[]
      }
      vat_workings: {
        Args: { p_month: string }
        Returns: {
          component: string
          credit_notes: number
          input_claimable: number
          is_vat: boolean
          net_payable: number
          output_tax: number
          withheld_by_clients: number
        }[]
      }
      working_days: {
        Args: { p_end: string; p_start: string }
        Returns: number
      }
    }
    Enums: {
      app_role:
        | "owner"
        | "director"
        | "accountant"
        | "admin"
        | "project_lead"
        | "staff"
      payout_status: "prepared" | "approved" | "paid" | "cancelled"
      review_status: "recorded" | "reviewed" | "queried" | "not_required"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      app_role: [
        "owner",
        "director",
        "accountant",
        "admin",
        "project_lead",
        "staff",
      ],
      payout_status: ["prepared", "approved", "paid", "cancelled"],
      review_status: ["recorded", "reviewed", "queried", "not_required"],
    },
  },
} as const
