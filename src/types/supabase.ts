/**
 * MANUAL PHASE 1 CONTRACT -- NOT AUTO-GENERATED.
 * 
 * Provides type contracts during initial development.
 * Replace with automated generation once Supabase CLI is running:
 * npm run typegen
 */

export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type UserRole = 'owner' | 'admin' | 'broker' | 'accountant' | 'warehouse' | 'client'

export type CaseStatus =
  | 'draft'
  | 'registration_order'
  | 'documents_ready'
  | 'epl_submitted'
  | 'kottaj_received'
  | 'path_green'
  | 'path_yellow'
  | 'path_red'
  | 'valuation'
  | 'duties_calculation'
  | 'exit_permit'
  | 'completed'
  | 'archived'

export type TransportMode = 'sea' | 'air' | 'land' | 'rail'
export type ContainerSize = '20DV' | '40DV' | '40HC' | '40RF' | 'LCL' | 'BULK'
export type CurrencyCode = 'IRR' | 'USD' | 'EUR' | 'AED' | 'CNY' | 'RUB' | 'GBP' | 'CHF' | 'TRY'
export type TransactionType = 'expense' | 'revenue' | 'deposit' | 'withdrawal'
export type PermitStatus = 'pending' | 'approved' | 'rejected' | 'not_required'

export type DocType =
  | 'proforma_invoice'
  | 'commercial_invoice'
  | 'packing_list'
  | 'bill_of_lading'
  | 'certificate_of_origin'
  | 'health_certificate'
  | 'standard_permit'
  | 'insurance'
  | 'customs_declaration'
  | 'exit_permit'
  | 'receipt'
  | 'other'

export interface Database {
  public: {
    Tables: {
      organizations: {
        Row: {
          id: string
          name: string
          economic_code: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          name: string
          economic_code?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          name?: string
          economic_code?: string | null
          created_at?: string
          updated_at?: string
        }
      }
      profiles: {
        Row: {
          id: string
          organization_id: string
          role: UserRole
          client_id: string | null
          full_name: string
          phone: string | null
          is_active: boolean
          created_at: string
          updated_at: string
        }
        Insert: {
          id: string
          organization_id: string
          role?: UserRole
          client_id?: string | null
          full_name: string
          phone?: string | null
          is_active?: boolean
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          organization_id?: never
          role?: UserRole
          client_id?: string | null
          full_name?: string
          phone?: string | null
          is_active?: boolean
          created_at?: string
          updated_at?: string
        }
      }
      cases: {
        Row: {
          id: string
          organization_id: string
          client_id: string
          assigned_broker_id: string | null
          customs_office_id: string | null
          case_number: string
          status: CaseStatus
          registration_order_no: string | null
          proforma_no: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          organization_id: string
          client_id: string
          assigned_broker_id?: string | null
          customs_office_id?: string | null
          case_number: string
          status?: CaseStatus
          registration_order_no?: string | null
          proforma_no?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          organization_id?: never
          client_id?: string
          assigned_broker_id?: string | null
          customs_office_id?: string | null
          case_number?: string
          status?: CaseStatus
          registration_order_no?: string | null
          proforma_no?: string | null
          created_at?: string
          updated_at?: string
        }
      }
    }
    Functions: {
      create_tenant_account: {
        Args: {
          org_name: string
          user_full_name: string
        }
        Returns: string
      }
    }
  }
}
