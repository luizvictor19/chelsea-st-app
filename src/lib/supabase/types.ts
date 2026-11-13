/**
 * Generated from the migrations in supabase/migrations, not from the deployed
 * project, so the types describe the schema this repository defines. Source
 * matters: the deployed project keeps pgcrypto in the extensions schema, and
 * generating from there silently drops its functions out of this file.
 *
 * Regenerate with scripts/gen-types.sh, which is the whole procedure in one
 * call. Never run the generator on its own: it writes the whole file, so the
 * comment you are reading is destroyed by any generation that does not put it
 * back, and putting it back is a step someone eventually forgets.
 *
 * Hand edits are lost on the next run.
 */

export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[];

export type Database = {
  public: {
    Tables: {
      assignment_items: {
        Row: {
          assignment_id: string;
          id: string;
          organization_id: string;
          position: number;
          question_id: string;
        };
        ComputedFields: never;
        Insert: {
          assignment_id: string;
          id?: string;
          organization_id: string;
          position: number;
          question_id: string;
        };
        Update: {
          assignment_id?: string;
          id?: string;
          organization_id?: string;
          position?: number;
          question_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "assignment_items_assignment_fkey";
            columns: ["organization_id", "assignment_id"];
            isOneToOne: false;
            referencedRelation: "assignments";
            referencedColumns: ["organization_id", "id"];
          },
          {
            foreignKeyName: "assignment_items_question_id_fkey";
            columns: ["question_id"];
            isOneToOne: false;
            referencedRelation: "questions";
            referencedColumns: ["id"];
          },
        ];
      };
      assignments: {
        Row: {
          completed_at: string | null;
          created_at: string;
          due_on: string;
          id: string;
          organization_id: string;
          student_id: string;
        };
        ComputedFields: never;
        Insert: {
          completed_at?: string | null;
          created_at?: string;
          due_on: string;
          id?: string;
          organization_id: string;
          student_id: string;
        };
        Update: {
          completed_at?: string | null;
          created_at?: string;
          due_on?: string;
          id?: string;
          organization_id?: string;
          student_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "assignments_student_fkey";
            columns: ["organization_id", "student_id"];
            isOneToOne: false;
            referencedRelation: "students";
            referencedColumns: ["organization_id", "id"];
          },
        ];
      };
      attempts: {
        Row: {
          assignment_item_id: string | null;
          audio_path: string;
          created_at: string;
          id: string;
          organization_id: string;
          question_id: string;
          reviewed_at: string | null;
          reviewed_by: string | null;
          student_id: string;
          teacher_note: string | null;
          transcript: string | null;
          verdict: Database["public"]["Enums"]["attempt_verdict"];
        };
        ComputedFields: never;
        Insert: {
          assignment_item_id?: string | null;
          audio_path: string;
          created_at?: string;
          id?: string;
          organization_id: string;
          question_id: string;
          reviewed_at?: string | null;
          reviewed_by?: string | null;
          student_id: string;
          teacher_note?: string | null;
          transcript?: string | null;
          verdict?: Database["public"]["Enums"]["attempt_verdict"];
        };
        Update: {
          assignment_item_id?: string | null;
          audio_path?: string;
          created_at?: string;
          id?: string;
          organization_id?: string;
          question_id?: string;
          reviewed_at?: string | null;
          reviewed_by?: string | null;
          student_id?: string;
          teacher_note?: string | null;
          transcript?: string | null;
          verdict?: Database["public"]["Enums"]["attempt_verdict"];
        };
        Relationships: [
          {
            foreignKeyName: "attempts_assignment_item_id_fkey";
            columns: ["assignment_item_id"];
            isOneToOne: false;
            referencedRelation: "assignment_items";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "attempts_question_id_fkey";
            columns: ["question_id"];
            isOneToOne: false;
            referencedRelation: "questions";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "attempts_reviewed_by_fkey";
            columns: ["reviewed_by"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "attempts_student_fkey";
            columns: ["organization_id", "student_id"];
            isOneToOne: false;
            referencedRelation: "students";
            referencedColumns: ["organization_id", "id"];
          },
        ];
      };
      billing_customers: {
        Row: {
          cpf_hmac: string;
          created_at: string;
          organization_id: string;
          person_id: string;
          trial_used_at: string | null;
        };
        ComputedFields: never;
        Insert: {
          cpf_hmac: string;
          created_at?: string;
          organization_id: string;
          person_id: string;
          trial_used_at?: string | null;
        };
        Update: {
          cpf_hmac?: string;
          created_at?: string;
          organization_id?: string;
          person_id?: string;
          trial_used_at?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "billing_customers_organization_id_fkey";
            columns: ["organization_id"];
            isOneToOne: false;
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "billing_customers_person_id_fkey";
            columns: ["person_id"];
            isOneToOne: true;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      billing_events: {
        Row: {
          error: string | null;
          event_id: string;
          event_type: string;
          payload: NonNullable<Json>;
          processed_at: string | null;
          received_at: string;
        };
        ComputedFields: never;
        Insert: {
          error?: string | null;
          event_id: string;
          event_type: string;
          payload: NonNullable<Json>;
          processed_at?: string | null;
          received_at?: string;
        };
        Update: {
          error?: string | null;
          event_id?: string;
          event_type?: string;
          payload?: NonNullable<Json>;
          processed_at?: string | null;
          received_at?: string;
        };
        Relationships: [];
      };
      blocks: {
        Row: {
          based_on_id: string | null;
          content: string;
          created_at: string;
          id: string;
          kind: Database["public"]["Enums"]["block_kind"];
          needs_review: boolean;
          organization_id: string | null;
          point_id: string;
          position: number;
          source_page: string | null;
        };
        ComputedFields: never;
        Insert: {
          based_on_id?: string | null;
          content: string;
          created_at?: string;
          id?: string;
          kind: Database["public"]["Enums"]["block_kind"];
          needs_review?: boolean;
          organization_id?: string | null;
          point_id: string;
          position: number;
          source_page?: string | null;
        };
        Update: {
          based_on_id?: string | null;
          content?: string;
          created_at?: string;
          id?: string;
          kind?: Database["public"]["Enums"]["block_kind"];
          needs_review?: boolean;
          organization_id?: string | null;
          point_id?: string;
          position?: number;
          source_page?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "blocks_based_on_id_fkey";
            columns: ["based_on_id"];
            isOneToOne: false;
            referencedRelation: "blocks";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "blocks_organization_id_fkey";
            columns: ["organization_id"];
            isOneToOne: false;
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "blocks_point_id_fkey";
            columns: ["point_id"];
            isOneToOne: false;
            referencedRelation: "points";
            referencedColumns: ["id"];
          },
        ];
      };
      books: {
        Row: {
          based_on_id: string | null;
          created_at: string;
          first_point: number | null;
          id: string;
          last_point: number | null;
          organization_id: string | null;
          position: number;
          title: string;
        };
        ComputedFields: never;
        Insert: {
          based_on_id?: string | null;
          created_at?: string;
          first_point?: number | null;
          id?: string;
          last_point?: number | null;
          organization_id?: string | null;
          position: number;
          title: string;
        };
        Update: {
          based_on_id?: string | null;
          created_at?: string;
          first_point?: number | null;
          id?: string;
          last_point?: number | null;
          organization_id?: string | null;
          position?: number;
          title?: string;
        };
        Relationships: [
          {
            foreignKeyName: "books_based_on_id_fkey";
            columns: ["based_on_id"];
            isOneToOne: false;
            referencedRelation: "books";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "books_organization_id_fkey";
            columns: ["organization_id"];
            isOneToOne: false;
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
        ];
      };
      contrast_set_items: {
        Row: {
          organization_id: string | null;
          position: number;
          set_id: string;
          vocabulary_item_id: string;
        };
        ComputedFields: never;
        Insert: {
          organization_id?: string | null;
          position: number;
          set_id: string;
          vocabulary_item_id: string;
        };
        Update: {
          organization_id?: string | null;
          position?: number;
          set_id?: string;
          vocabulary_item_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "contrast_set_items_organization_id_fkey";
            columns: ["organization_id"];
            isOneToOne: false;
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "contrast_set_items_set_id_fkey";
            columns: ["set_id"];
            isOneToOne: false;
            referencedRelation: "contrast_sets";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "contrast_set_items_vocabulary_item_id_fkey";
            columns: ["vocabulary_item_id"];
            isOneToOne: true;
            referencedRelation: "vocabulary_items";
            referencedColumns: ["id"];
          },
        ];
      };
      contrast_sets: {
        Row: {
          based_on_id: string | null;
          created_at: string;
          id: string;
          organization_id: string | null;
        };
        ComputedFields: never;
        Insert: {
          based_on_id?: string | null;
          created_at?: string;
          id?: string;
          organization_id?: string | null;
        };
        Update: {
          based_on_id?: string | null;
          created_at?: string;
          id?: string;
          organization_id?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "contrast_sets_based_on_id_fkey";
            columns: ["based_on_id"];
            isOneToOne: false;
            referencedRelation: "contrast_sets";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "contrast_sets_organization_id_fkey";
            columns: ["organization_id"];
            isOneToOne: false;
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
        ];
      };
      credit_costs: {
        Row: {
          action: string;
          brand: string;
          created_at: string;
          credits: number;
          id: string;
          organization_id: string | null;
          updated_at: string;
        };
        ComputedFields: never;
        Insert: {
          action: string;
          brand: string;
          created_at?: string;
          credits: number;
          id?: string;
          organization_id?: string | null;
          updated_at?: string;
        };
        Update: {
          action?: string;
          brand?: string;
          created_at?: string;
          credits?: number;
          id?: string;
          organization_id?: string | null;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "credit_costs_organization_id_fkey";
            columns: ["organization_id"];
            isOneToOne: false;
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
        ];
      };
      credit_entries: {
        Row: {
          action: string | null;
          amount: number;
          asaas_payment_id: string | null;
          created_at: string;
          expires_at: string | null;
          id: string;
          kind: string;
          lot_id: string | null;
          organization_id: string;
          period: number | null;
          person_id: string;
          reference: string | null;
          refers_to: string | null;
          seq: number;
          subscription_id: string | null;
        };
        ComputedFields: never;
        Insert: {
          action?: string | null;
          amount: number;
          asaas_payment_id?: string | null;
          created_at?: string;
          expires_at?: string | null;
          id?: string;
          kind: string;
          lot_id?: string | null;
          organization_id: string;
          period?: number | null;
          person_id: string;
          reference?: string | null;
          refers_to?: string | null;
          seq?: never;
          subscription_id?: string | null;
        };
        Update: {
          action?: string | null;
          amount?: number;
          asaas_payment_id?: string | null;
          created_at?: string;
          expires_at?: string | null;
          id?: string;
          kind?: string;
          lot_id?: string | null;
          organization_id?: string;
          period?: number | null;
          person_id?: string;
          reference?: string | null;
          refers_to?: string | null;
          seq?: never;
          subscription_id?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "credit_entries_asaas_payment_id_fkey";
            columns: ["asaas_payment_id"];
            isOneToOne: false;
            referencedRelation: "payments";
            referencedColumns: ["asaas_payment_id"];
          },
          {
            foreignKeyName: "credit_entries_lot_id_fkey";
            columns: ["lot_id"];
            isOneToOne: false;
            referencedRelation: "credit_entries";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "credit_entries_organization_id_fkey";
            columns: ["organization_id"];
            isOneToOne: false;
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "credit_entries_person_id_fkey";
            columns: ["person_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "credit_entries_refers_to_fkey";
            columns: ["refers_to"];
            isOneToOne: false;
            referencedRelation: "credit_entries";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "credit_entries_subscription_id_fkey";
            columns: ["subscription_id"];
            isOneToOne: false;
            referencedRelation: "subscriptions";
            referencedColumns: ["id"];
          },
        ];
      };
      image_attempts: {
        Row: {
          completed_at: string | null;
          composed_from: string[] | null;
          created_at: string;
          credits_spent: number | null;
          decided_at: string | null;
          error: string | null;
          id: string;
          model: string | null;
          organization_id: string | null;
          prompt: string | null;
          provider: string;
          provider_request_id: string | null;
          reference_path: string | null;
          scene_id: string | null;
          source_filename: string | null;
          status: string;
          storage_path: string | null;
          subject: string | null;
          vocabulary_item_id: string | null;
        };
        ComputedFields: never;
        Insert: {
          completed_at?: string | null;
          composed_from?: string[] | null;
          created_at?: string;
          credits_spent?: number | null;
          decided_at?: string | null;
          error?: string | null;
          id?: string;
          model?: string | null;
          organization_id?: string | null;
          prompt?: string | null;
          provider: string;
          provider_request_id?: string | null;
          reference_path?: string | null;
          scene_id?: string | null;
          source_filename?: string | null;
          status: string;
          storage_path?: string | null;
          subject?: string | null;
          vocabulary_item_id?: string | null;
        };
        Update: {
          completed_at?: string | null;
          composed_from?: string[] | null;
          created_at?: string;
          credits_spent?: number | null;
          decided_at?: string | null;
          error?: string | null;
          id?: string;
          model?: string | null;
          organization_id?: string | null;
          prompt?: string | null;
          provider?: string;
          provider_request_id?: string | null;
          reference_path?: string | null;
          scene_id?: string | null;
          source_filename?: string | null;
          status?: string;
          storage_path?: string | null;
          subject?: string | null;
          vocabulary_item_id?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "image_attempts_organization_id_fkey";
            columns: ["organization_id"];
            isOneToOne: false;
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "image_attempts_scene_id_fkey";
            columns: ["scene_id"];
            isOneToOne: false;
            referencedRelation: "scenes";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "image_attempts_vocabulary_item_id_fkey";
            columns: ["vocabulary_item_id"];
            isOneToOne: false;
            referencedRelation: "vocabulary_items";
            referencedColumns: ["id"];
          },
        ];
      };
      leads: {
        Row: {
          codigo_origem: string | null;
          created_at: string;
          id: string;
          interesse: string;
          nivel: string | null;
          nome: string;
          objetivo: string | null;
          user_agent: string | null;
          utm_campaign: string | null;
          utm_medium: string | null;
          utm_source: string | null;
          whatsapp: string;
        };
        ComputedFields: never;
        Insert: {
          codigo_origem?: string | null;
          created_at?: string;
          id?: string;
          interesse: string;
          nivel?: string | null;
          nome: string;
          objetivo?: string | null;
          user_agent?: string | null;
          utm_campaign?: string | null;
          utm_medium?: string | null;
          utm_source?: string | null;
          whatsapp: string;
        };
        Update: {
          codigo_origem?: string | null;
          created_at?: string;
          id?: string;
          interesse?: string;
          nivel?: string | null;
          nome?: string;
          objetivo?: string | null;
          user_agent?: string | null;
          utm_campaign?: string | null;
          utm_medium?: string | null;
          utm_source?: string | null;
          whatsapp?: string;
        };
        Relationships: [];
      };
      lesson_schedules: {
        Row: {
          created_at: string;
          duration_minutes: number;
          id: string;
          is_active: boolean;
          organization_id: string;
          start_time: string;
          student_id: string;
          timezone: string;
          weekday: number;
        };
        ComputedFields: never;
        Insert: {
          created_at?: string;
          duration_minutes?: number;
          id?: string;
          is_active?: boolean;
          organization_id: string;
          start_time: string;
          student_id: string;
          timezone?: string;
          weekday: number;
        };
        Update: {
          created_at?: string;
          duration_minutes?: number;
          id?: string;
          is_active?: boolean;
          organization_id?: string;
          start_time?: string;
          student_id?: string;
          timezone?: string;
          weekday?: number;
        };
        Relationships: [
          {
            foreignKeyName: "lesson_schedules_student_fkey";
            columns: ["organization_id", "student_id"];
            isOneToOne: false;
            referencedRelation: "students";
            referencedColumns: ["organization_id", "id"];
          },
        ];
      };
      lessons: {
        Row: {
          created_at: string;
          duration_minutes: number;
          id: string;
          meet_url: string | null;
          organization_id: string;
          scheduled_at: string;
          status: Database["public"]["Enums"]["lesson_status"];
          stopped_at_point_id: string | null;
          student_id: string;
          teacher_note: string | null;
        };
        ComputedFields: never;
        Insert: {
          created_at?: string;
          duration_minutes?: number;
          id?: string;
          meet_url?: string | null;
          organization_id: string;
          scheduled_at: string;
          status?: Database["public"]["Enums"]["lesson_status"];
          stopped_at_point_id?: string | null;
          student_id: string;
          teacher_note?: string | null;
        };
        Update: {
          created_at?: string;
          duration_minutes?: number;
          id?: string;
          meet_url?: string | null;
          organization_id?: string;
          scheduled_at?: string;
          status?: Database["public"]["Enums"]["lesson_status"];
          stopped_at_point_id?: string | null;
          student_id?: string;
          teacher_note?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "lessons_stopped_at_point_fkey";
            columns: ["stopped_at_point_id"];
            isOneToOne: false;
            referencedRelation: "points";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "lessons_student_fkey";
            columns: ["organization_id", "student_id"];
            isOneToOne: false;
            referencedRelation: "students";
            referencedColumns: ["organization_id", "id"];
          },
        ];
      };
      lessons_content: {
        Row: {
          based_on_id: string | null;
          book_id: string;
          created_at: string;
          first_point: number;
          id: string;
          last_point: number;
          number: number;
          organization_id: string | null;
        };
        ComputedFields: never;
        Insert: {
          based_on_id?: string | null;
          book_id: string;
          created_at?: string;
          first_point: number;
          id?: string;
          last_point: number;
          number: number;
          organization_id?: string | null;
        };
        Update: {
          based_on_id?: string | null;
          book_id?: string;
          created_at?: string;
          first_point?: number;
          id?: string;
          last_point?: number;
          number?: number;
          organization_id?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "lessons_content_based_on_id_fkey";
            columns: ["based_on_id"];
            isOneToOne: false;
            referencedRelation: "lessons_content";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "lessons_content_book_id_fkey";
            columns: ["book_id"];
            isOneToOne: false;
            referencedRelation: "books";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "lessons_content_organization_id_fkey";
            columns: ["organization_id"];
            isOneToOne: false;
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
        ];
      };
      organization_invites: {
        Row: {
          accepted_at: string | null;
          created_at: string;
          email: string;
          expires_at: string;
          id: string;
          invited_by: string | null;
          organization_id: string;
          role: Database["public"]["Enums"]["organization_role"];
        };
        ComputedFields: never;
        Insert: {
          accepted_at?: string | null;
          created_at?: string;
          email: string;
          expires_at?: string;
          id?: string;
          invited_by?: string | null;
          organization_id: string;
          role: Database["public"]["Enums"]["organization_role"];
        };
        Update: {
          accepted_at?: string | null;
          created_at?: string;
          email?: string;
          expires_at?: string;
          id?: string;
          invited_by?: string | null;
          organization_id?: string;
          role?: Database["public"]["Enums"]["organization_role"];
        };
        Relationships: [
          {
            foreignKeyName: "organization_invites_invited_by_fkey";
            columns: ["invited_by"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "organization_invites_organization_id_fkey";
            columns: ["organization_id"];
            isOneToOne: false;
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
        ];
      };
      organization_members: {
        Row: {
          created_at: string;
          organization_id: string;
          role: Database["public"]["Enums"]["organization_role"];
          user_id: string;
        };
        ComputedFields: never;
        Insert: {
          created_at?: string;
          organization_id: string;
          role: Database["public"]["Enums"]["organization_role"];
          user_id: string;
        };
        Update: {
          created_at?: string;
          organization_id?: string;
          role?: Database["public"]["Enums"]["organization_role"];
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "organization_members_organization_id_fkey";
            columns: ["organization_id"];
            isOneToOne: false;
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "organization_members_user_id_fkey";
            columns: ["user_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      organizations: {
        Row: {
          brand: string;
          created_at: string;
          has_teacher: boolean;
          id: string;
          name: string;
          open_signup: boolean;
          slug: string;
        };
        ComputedFields: never;
        Insert: {
          brand: string;
          created_at?: string;
          has_teacher: boolean;
          id?: string;
          name: string;
          open_signup?: boolean;
          slug: string;
        };
        Update: {
          brand?: string;
          created_at?: string;
          has_teacher?: boolean;
          id?: string;
          name?: string;
          open_signup?: boolean;
          slug?: string;
        };
        Relationships: [];
      };
      overdue_steps: {
        Row: {
          asaas_payment_id: string;
          created_at: string;
          day: number;
          emailed_at: string | null;
          outcome: string | null;
        };
        ComputedFields: never;
        Insert: {
          asaas_payment_id: string;
          created_at?: string;
          day: number;
          emailed_at?: string | null;
          outcome?: string | null;
        };
        Update: {
          asaas_payment_id?: string;
          created_at?: string;
          day?: number;
          emailed_at?: string | null;
          outcome?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "overdue_steps_asaas_payment_id_fkey";
            columns: ["asaas_payment_id"];
            isOneToOne: false;
            referencedRelation: "payments";
            referencedColumns: ["asaas_payment_id"];
          },
        ];
      };
      payments: {
        Row: {
          asaas_payment_id: string;
          asaas_status: string;
          created_at: string;
          deleted: boolean;
          due_on: string;
          invoice_url: string | null;
          kind: string;
          organization_id: string;
          paid_at: string | null;
          person_id: string;
          refunded_cents: number;
          subscription_id: string | null;
          updated_at: string;
          value_cents: number;
          credit_payment_grants: boolean | null;
          credit_payment_taken_back: boolean | null;
        };
        ComputedFields: "credit_payment_grants" | "credit_payment_taken_back";
        Insert: {
          asaas_payment_id: string;
          asaas_status: string;
          created_at?: string;
          deleted?: boolean;
          due_on: string;
          invoice_url?: string | null;
          kind: string;
          organization_id: string;
          paid_at?: string | null;
          person_id: string;
          refunded_cents?: number;
          subscription_id?: string | null;
          updated_at?: string;
          value_cents: number;
        };
        Update: {
          asaas_payment_id?: string;
          asaas_status?: string;
          created_at?: string;
          deleted?: boolean;
          due_on?: string;
          invoice_url?: string | null;
          kind?: string;
          organization_id?: string;
          paid_at?: string | null;
          person_id?: string;
          refunded_cents?: number;
          subscription_id?: string | null;
          updated_at?: string;
          value_cents?: number;
        };
        Relationships: [
          {
            foreignKeyName: "payments_organization_id_fkey";
            columns: ["organization_id"];
            isOneToOne: false;
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "payments_person_id_fkey";
            columns: ["person_id"];
            isOneToOne: false;
            referencedRelation: "billing_customers";
            referencedColumns: ["person_id"];
          },
          {
            foreignKeyName: "payments_subscription_id_fkey";
            columns: ["subscription_id"];
            isOneToOne: false;
            referencedRelation: "subscriptions";
            referencedColumns: ["id"];
          },
        ];
      };
      plans: {
        Row: {
          annual_price_cents: number;
          brand: string;
          created_at: string;
          credit_ceiling_months: number;
          credit_days_after_cancel: number;
          id: string;
          is_active: boolean;
          key: string;
          monthly_credits: number;
          monthly_price_cents: number;
          name: string;
          opens_free_conversation: boolean;
          opens_video: boolean;
          opens_voice_question: boolean;
          organization_id: string | null;
          position: number;
          trail_minutes_per_day: number;
          trial_credits: number;
          trial_days: number;
          updated_at: string;
        };
        ComputedFields: never;
        Insert: {
          annual_price_cents: number;
          brand: string;
          created_at?: string;
          credit_ceiling_months: number;
          credit_days_after_cancel: number;
          id?: string;
          is_active?: boolean;
          key: string;
          monthly_credits: number;
          monthly_price_cents: number;
          name: string;
          opens_free_conversation: boolean;
          opens_video: boolean;
          opens_voice_question: boolean;
          organization_id?: string | null;
          position?: number;
          trail_minutes_per_day: number;
          trial_credits: number;
          trial_days: number;
          updated_at?: string;
        };
        Update: {
          annual_price_cents?: number;
          brand?: string;
          created_at?: string;
          credit_ceiling_months?: number;
          credit_days_after_cancel?: number;
          id?: string;
          is_active?: boolean;
          key?: string;
          monthly_credits?: number;
          monthly_price_cents?: number;
          name?: string;
          opens_free_conversation?: boolean;
          opens_video?: boolean;
          opens_voice_question?: boolean;
          organization_id?: string | null;
          position?: number;
          trail_minutes_per_day?: number;
          trial_credits?: number;
          trial_days?: number;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "plans_organization_id_fkey";
            columns: ["organization_id"];
            isOneToOne: false;
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
        ];
      };
      platform_admins: {
        Row: {
          created_at: string;
          user_id: string;
        };
        ComputedFields: never;
        Insert: {
          created_at?: string;
          user_id: string;
        };
        Update: {
          created_at?: string;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "platform_admins_user_id_fkey";
            columns: ["user_id"];
            isOneToOne: true;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      points: {
        Row: {
          based_on_id: string | null;
          book_id: string;
          created_at: string;
          filled_at: string | null;
          id: string;
          lesson_content_id: string | null;
          number: number;
          organization_id: string | null;
        };
        ComputedFields: never;
        Insert: {
          based_on_id?: string | null;
          book_id: string;
          created_at?: string;
          filled_at?: string | null;
          id?: string;
          lesson_content_id?: string | null;
          number: number;
          organization_id?: string | null;
        };
        Update: {
          based_on_id?: string | null;
          book_id?: string;
          created_at?: string;
          filled_at?: string | null;
          id?: string;
          lesson_content_id?: string | null;
          number?: number;
          organization_id?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "points_based_on_id_fkey";
            columns: ["based_on_id"];
            isOneToOne: false;
            referencedRelation: "points";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "points_book_id_fkey";
            columns: ["book_id"];
            isOneToOne: false;
            referencedRelation: "books";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "points_lesson_content_id_fkey";
            columns: ["lesson_content_id"];
            isOneToOne: false;
            referencedRelation: "lessons_content";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "points_organization_id_fkey";
            columns: ["organization_id"];
            isOneToOne: false;
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
        ];
      };
      profiles: {
        Row: {
          created_at: string;
          full_name: string;
          id: string;
          timezone: string;
        };
        ComputedFields: never;
        Insert: {
          created_at?: string;
          full_name: string;
          id: string;
          timezone?: string;
        };
        Update: {
          created_at?: string;
          full_name?: string;
          id?: string;
          timezone?: string;
        };
        Relationships: [];
      };
      questions: {
        Row: {
          answer_language: Database["public"]["Enums"]["answer_language"];
          based_on_id: string | null;
          created_at: string;
          expected_answer: string;
          id: string;
          image_path: string | null;
          is_acted_out: boolean;
          is_published: boolean;
          organization_id: string | null;
          point_id: string;
          position: number;
          prompt: string;
          prompt_audio_path: string | null;
          scene_id: string | null;
          shown_vocabulary_item_id: string | null;
          suggested_answer: string | null;
          suggested_model: string | null;
          suggested_prompt: string | null;
        };
        ComputedFields: never;
        Insert: {
          answer_language?: Database["public"]["Enums"]["answer_language"];
          based_on_id?: string | null;
          created_at?: string;
          expected_answer: string;
          id?: string;
          image_path?: string | null;
          is_acted_out?: boolean;
          is_published?: boolean;
          organization_id?: string | null;
          point_id: string;
          position: number;
          prompt: string;
          prompt_audio_path?: string | null;
          scene_id?: string | null;
          shown_vocabulary_item_id?: string | null;
          suggested_answer?: string | null;
          suggested_model?: string | null;
          suggested_prompt?: string | null;
        };
        Update: {
          answer_language?: Database["public"]["Enums"]["answer_language"];
          based_on_id?: string | null;
          created_at?: string;
          expected_answer?: string;
          id?: string;
          image_path?: string | null;
          is_acted_out?: boolean;
          is_published?: boolean;
          organization_id?: string | null;
          point_id?: string;
          position?: number;
          prompt?: string;
          prompt_audio_path?: string | null;
          scene_id?: string | null;
          shown_vocabulary_item_id?: string | null;
          suggested_answer?: string | null;
          suggested_model?: string | null;
          suggested_prompt?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "questions_based_on_id_fkey";
            columns: ["based_on_id"];
            isOneToOne: false;
            referencedRelation: "questions";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "questions_organization_id_fkey";
            columns: ["organization_id"];
            isOneToOne: false;
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "questions_point_id_fkey";
            columns: ["point_id"];
            isOneToOne: false;
            referencedRelation: "points";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "questions_scene_id_fkey";
            columns: ["scene_id"];
            isOneToOne: false;
            referencedRelation: "scenes";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "questions_shown_vocabulary_item_id_fkey";
            columns: ["shown_vocabulary_item_id"];
            isOneToOne: false;
            referencedRelation: "vocabulary_items";
            referencedColumns: ["id"];
          },
        ];
      };
      review_schedule: {
        Row: {
          due_on: string;
          ease: number;
          interval_days: number;
          organization_id: string;
          question_id: string;
          repetitions: number;
          student_id: string;
        };
        ComputedFields: never;
        Insert: {
          due_on?: string;
          ease?: number;
          interval_days?: number;
          organization_id: string;
          question_id: string;
          repetitions?: number;
          student_id: string;
        };
        Update: {
          due_on?: string;
          ease?: number;
          interval_days?: number;
          organization_id?: string;
          question_id?: string;
          repetitions?: number;
          student_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "review_schedule_question_id_fkey";
            columns: ["question_id"];
            isOneToOne: false;
            referencedRelation: "questions";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "review_schedule_student_fkey";
            columns: ["organization_id", "student_id"];
            isOneToOne: false;
            referencedRelation: "students";
            referencedColumns: ["organization_id", "id"];
          },
        ];
      };
      scenes: {
        Row: {
          approved_attempt_id: string | null;
          archived_at: string | null;
          based_on_id: string | null;
          composed_from: string[] | null;
          created_at: string;
          description: string;
          id: string;
          image_path: string | null;
          image_style: Database["public"]["Enums"]["image_style"];
          organization_id: string | null;
          reference_path: string | null;
        };
        ComputedFields: never;
        Insert: {
          approved_attempt_id?: string | null;
          archived_at?: string | null;
          based_on_id?: string | null;
          composed_from?: string[] | null;
          created_at?: string;
          description: string;
          id?: string;
          image_path?: string | null;
          image_style?: Database["public"]["Enums"]["image_style"];
          organization_id?: string | null;
          reference_path?: string | null;
        };
        Update: {
          approved_attempt_id?: string | null;
          archived_at?: string | null;
          based_on_id?: string | null;
          composed_from?: string[] | null;
          created_at?: string;
          description?: string;
          id?: string;
          image_path?: string | null;
          image_style?: Database["public"]["Enums"]["image_style"];
          organization_id?: string | null;
          reference_path?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "scenes_approved_attempt_id_fkey";
            columns: ["approved_attempt_id"];
            isOneToOne: false;
            referencedRelation: "image_attempts";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "scenes_based_on_id_fkey";
            columns: ["based_on_id"];
            isOneToOne: false;
            referencedRelation: "scenes";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "scenes_organization_id_fkey";
            columns: ["organization_id"];
            isOneToOne: false;
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
        ];
      };
      students: {
        Row: {
          id: string;
          is_active: boolean;
          meet_url: string | null;
          member_role: Database["public"]["Enums"]["organization_role"];
          organization_id: string;
          started_on: string | null;
        };
        ComputedFields: never;
        Insert: {
          id: string;
          is_active?: boolean;
          meet_url?: string | null;
          member_role?: never;
          organization_id: string;
          started_on?: string | null;
        };
        Update: {
          id?: string;
          is_active?: boolean;
          meet_url?: string | null;
          member_role?: never;
          organization_id?: string;
          started_on?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "students_id_fkey";
            columns: ["id"];
            isOneToOne: true;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "students_membership_fkey";
            columns: ["organization_id", "id", "member_role"];
            isOneToOne: false;
            referencedRelation: "organization_members";
            referencedColumns: ["organization_id", "user_id", "role"];
          },
          {
            foreignKeyName: "students_organization_id_fkey";
            columns: ["organization_id"];
            isOneToOne: false;
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
        ];
      };
      subscriptions: {
        Row: {
          asaas_checkout_id: string | null;
          asaas_customer_id: string | null;
          asaas_subscription_id: string | null;
          billing_type: string;
          cancel_reason: string | null;
          canceled_at: string | null;
          created_at: string;
          credit_ceiling_months: number;
          credit_days_after_cancel: number;
          cycle: string;
          first_due_on: string;
          id: string;
          monthly_credits: number;
          organization_id: string;
          paid_through: string | null;
          past_due_since: string | null;
          person_id: string;
          plan_id: string;
          status: string;
          updated_at: string;
          value_cents: number;
          with_trial: boolean;
        };
        ComputedFields: never;
        Insert: {
          asaas_checkout_id?: string | null;
          asaas_customer_id?: string | null;
          asaas_subscription_id?: string | null;
          billing_type: string;
          cancel_reason?: string | null;
          canceled_at?: string | null;
          created_at?: string;
          credit_ceiling_months: number;
          credit_days_after_cancel: number;
          cycle: string;
          first_due_on: string;
          id?: string;
          monthly_credits: number;
          organization_id: string;
          paid_through?: string | null;
          past_due_since?: string | null;
          person_id: string;
          plan_id: string;
          status: string;
          updated_at?: string;
          value_cents: number;
          with_trial: boolean;
        };
        Update: {
          asaas_checkout_id?: string | null;
          asaas_customer_id?: string | null;
          asaas_subscription_id?: string | null;
          billing_type?: string;
          cancel_reason?: string | null;
          canceled_at?: string | null;
          created_at?: string;
          credit_ceiling_months?: number;
          credit_days_after_cancel?: number;
          cycle?: string;
          first_due_on?: string;
          id?: string;
          monthly_credits?: number;
          organization_id?: string;
          paid_through?: string | null;
          past_due_since?: string | null;
          person_id?: string;
          plan_id?: string;
          status?: string;
          updated_at?: string;
          value_cents?: number;
          with_trial?: boolean;
        };
        Relationships: [
          {
            foreignKeyName: "subscriptions_organization_id_fkey";
            columns: ["organization_id"];
            isOneToOne: false;
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "subscriptions_person_id_fkey";
            columns: ["person_id"];
            isOneToOne: false;
            referencedRelation: "billing_customers";
            referencedColumns: ["person_id"];
          },
          {
            foreignKeyName: "subscriptions_plan_id_fkey";
            columns: ["plan_id"];
            isOneToOne: false;
            referencedRelation: "plans";
            referencedColumns: ["id"];
          },
        ];
      };
      vocabulary_items: {
        Row: {
          approved_attempt_id: string | null;
          based_on_id: string | null;
          created_at: string;
          first_point_id: string;
          id: string;
          image_path: string | null;
          image_style: Database["public"]["Enums"]["image_style"];
          image_subject: string | null;
          organization_id: string | null;
          reference_path: string | null;
          representation:
            Database["public"]["Enums"]["representation_kind"] | null;
          suggested_representation:
            Database["public"]["Enums"]["representation_kind"] | null;
          suggestion_run_id: string | null;
          term: string;
          word_class: Database["public"]["Enums"]["word_class"] | null;
        };
        ComputedFields: never;
        Insert: {
          approved_attempt_id?: string | null;
          based_on_id?: string | null;
          created_at?: string;
          first_point_id: string;
          id?: string;
          image_path?: string | null;
          image_style?: Database["public"]["Enums"]["image_style"];
          image_subject?: string | null;
          organization_id?: string | null;
          reference_path?: string | null;
          representation?:
            Database["public"]["Enums"]["representation_kind"] | null;
          suggested_representation?:
            Database["public"]["Enums"]["representation_kind"] | null;
          suggestion_run_id?: string | null;
          term: string;
          word_class?: Database["public"]["Enums"]["word_class"] | null;
        };
        Update: {
          approved_attempt_id?: string | null;
          based_on_id?: string | null;
          created_at?: string;
          first_point_id?: string;
          id?: string;
          image_path?: string | null;
          image_style?: Database["public"]["Enums"]["image_style"];
          image_subject?: string | null;
          organization_id?: string | null;
          reference_path?: string | null;
          representation?:
            Database["public"]["Enums"]["representation_kind"] | null;
          suggested_representation?:
            Database["public"]["Enums"]["representation_kind"] | null;
          suggestion_run_id?: string | null;
          term?: string;
          word_class?: Database["public"]["Enums"]["word_class"] | null;
        };
        Relationships: [
          {
            foreignKeyName: "vocabulary_items_approved_attempt_id_fkey";
            columns: ["approved_attempt_id"];
            isOneToOne: false;
            referencedRelation: "image_attempts";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "vocabulary_items_based_on_id_fkey";
            columns: ["based_on_id"];
            isOneToOne: false;
            referencedRelation: "vocabulary_items";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "vocabulary_items_first_point_id_fkey";
            columns: ["first_point_id"];
            isOneToOne: false;
            referencedRelation: "points";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "vocabulary_items_organization_id_fkey";
            columns: ["organization_id"];
            isOneToOne: false;
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
        ];
      };
    };
    Views: {
      leads_latest: {
        Row: {
          codigo_origem: string | null;
          created_at: string;
          id: string;
          interesse: string;
          nivel: string | null;
          nome: string;
          objetivo: string | null;
          user_agent: string | null;
          utm_campaign: string | null;
          utm_medium: string | null;
          utm_source: string | null;
          whatsapp: string;
        };
        ComputedFields: never;
        Relationships: [];
      };
    };
    Functions: {
      accept_my_organization_invite: {
        Args: { p_invite: string };
        Returns: undefined;
      };
      accept_organization_invites: {
        Args: { p_email: string; p_user: string };
        Returns: undefined;
      };
      approve_image_attempt: {
        Args: { p_attempt: string };
        Returns: undefined;
      };
      belongs_anywhere: { Args: Record<PropertyKey, never>; Returns: boolean };
      billing_apply_subscription: {
        Args: {
          p_cancel_reason: string;
          p_customer_id: string;
          p_id: string;
          p_paid_through: string;
          p_past_due_since: string;
          p_status: string;
          p_subscription_id: string;
        };
        Returns: undefined;
      };
      billing_customer: {
        Args: { p_cpf_hmac: string; p_person: string };
        Returns: string;
      };
      billing_find_subscription: {
        Args: { p_checkout_id: string; p_subscription_id: string };
        Returns: {
          asaas_checkout_id: string | null;
          asaas_customer_id: string | null;
          asaas_subscription_id: string | null;
          billing_type: string;
          cancel_reason: string | null;
          canceled_at: string | null;
          created_at: string;
          credit_ceiling_months: number;
          credit_days_after_cancel: number;
          cycle: string;
          first_due_on: string;
          id: string;
          monthly_credits: number;
          organization_id: string;
          paid_through: string | null;
          past_due_since: string | null;
          person_id: string;
          plan_id: string;
          status: string;
          updated_at: string;
          value_cents: number;
          with_trial: boolean;
        }[];
        SetofOptions: {
          from: "*";
          to: "subscriptions";
          isOneToOne: false;
          isSetofReturn: true;
        };
      };
      billing_finish_event: {
        Args: { p_error: string; p_event_id: string };
        Returns: undefined;
      };
      billing_finish_overdue_step: {
        Args: {
          p_day: number;
          p_emailed: boolean;
          p_outcome: string;
          p_payment_id: string;
        };
        Returns: undefined;
      };
      billing_open_subscription: {
        Args: {
          p_billing_type: string;
          p_checkout_id: string;
          p_customer_id: string;
          p_cycle: string;
          p_first_due_on: string;
          p_person: string;
          p_plan: string;
          p_subscription_id: string;
          p_value_cents: number;
          p_with_trial: boolean;
        };
        Returns: string;
      };
      billing_overdue_payments: {
        Args: Record<PropertyKey, never>;
        Returns: {
          asaas_payment_id: string;
          billing_type: string;
          due_on: string;
          invoice_url: string;
          person_id: string;
          subscription_id: string;
        }[];
      };
      billing_record_event: {
        Args: { p_event_id: string; p_event_type: string; p_payload: Json };
        Returns: boolean;
      };
      billing_save_payment: {
        Args: {
          p_asaas_status: string;
          p_deleted: boolean;
          p_due_on: string;
          p_invoice_url: string;
          p_kind: string;
          p_paid_at: string;
          p_payment_id: string;
          p_refunded_cents: number;
          p_subscription: string;
          p_value_cents: number;
        };
        Returns: undefined;
      };
      billing_take_overdue_step: {
        Args: { p_day: number; p_payment_id: string };
        Returns: boolean;
      };
      can_invite: {
        Args: {
          p_organization: string;
          p_role: Database["public"]["Enums"]["organization_role"];
        };
        Returns: boolean;
      };
      can_write_content: { Args: { p_organization: string }; Returns: boolean };
      clear_word_representation: {
        Args: {
          p_kind: Database["public"]["Enums"]["representation_kind"];
          p_word: string;
        };
        Returns: undefined;
      };
      credit_alive: { Args: { p_person: string }; Returns: boolean };
      credit_balance_of: { Args: { p_person: string }; Returns: number };
      credit_check_reader: { Args: { p_person: string }; Returns: undefined };
      credit_close_expired: { Args: { p_person: string }; Returns: number };
      credit_cost: {
        Args: { p_action: string; p_person: string };
        Returns: number;
      };
      credit_daily: {
        Args: Record<PropertyKey, never>;
        Returns: Record<string, unknown>;
      };
      credit_deadline: { Args: { p_person: string }; Returns: string };
      credit_debit: {
        Args: {
          p_action: string;
          p_person: string;
          p_quantity: number;
          p_reference: string;
        };
        Returns: number;
      };
      credit_grant_started: { Args: { p_person: string }; Returns: undefined };
      credit_live_lots: {
        Args: { p_person: string };
        Returns: {
          expires_at: string;
          kind: string;
          lot_id: string;
          remaining: number;
        }[];
      };
      credit_lock_person: { Args: { p_person: string }; Returns: undefined };
      credit_lots_of: {
        Args: { p_person: string };
        Returns: {
          expires_at: string;
          kind: string;
          lot_id: string;
          organization_id: string;
          remaining: number;
          seq: number;
        }[];
      };
      credit_month_starts: {
        Args: { p_due_on: string; p_month: number };
        Returns: string;
      };
      credit_payment_grants: {
        Args: {
          p_payment: Omit<
            Database["public"]["Tables"]["payments"]["Row"],
            Database["public"]["Tables"]["payments"]["ComputedFields"]
          >;
        };
        Returns: boolean;
      };
      credit_payment_lots: {
        Args: { p_payment_id: string };
        Returns: {
          lot_id: string;
          organization_id: string;
          person_id: string;
          remaining: number;
        }[];
      };
      credit_payment_open_lots: {
        Args: { p_payment_id: string };
        Returns: {
          lot_id: string;
          organization_id: string;
          person_id: string;
          remaining: number;
        }[];
      };
      credit_payment_taken_back: {
        Args: {
          p_payment: Omit<
            Database["public"]["Tables"]["payments"]["Row"],
            Database["public"]["Tables"]["payments"]["ComputedFields"]
          >;
        };
        Returns: boolean;
      };
      credit_price: {
        Args: { p_action: string; p_person: string };
        Returns: number;
      };
      credit_refund: {
        Args: { p_person: string; p_reference: string };
        Returns: number;
      };
      credit_refund_quote: {
        Args: { p_payment_id: string };
        Returns: Record<string, unknown>;
      };
      credit_settle: {
        Args: { p_payment_id: string };
        Returns: Record<string, unknown>;
      };
      credit_settle_payment: {
        Args: { p_payment_id: string };
        Returns: number;
      };
      credits_balance: { Args: { p_person: string }; Returns: number };
      dearmor: { Args: { "": string }; Returns: string };
      delete_question: { Args: { p_question_id: string }; Returns: undefined };
      dissolve_contrast_set: { Args: { p_set_id: string }; Returns: undefined };
      gen_random_uuid: { Args: Record<PropertyKey, never>; Returns: string };
      gen_salt: { Args: { "": string }; Returns: string };
      is_known_time_zone: { Args: { p_zone: string }; Returns: boolean };
      is_organization_member: {
        Args: {
          p_organization: string;
          p_roles?: Database["public"]["Enums"]["organization_role"][];
        };
        Returns: boolean;
      };
      is_platform_admin: { Args: Record<PropertyKey, never>; Returns: boolean };
      is_reference_list: { Args: { p_paths: string[] }; Returns: boolean };
      join_by_signup: {
        Args: { p_meta: Json; p_user: string };
        Returns: undefined;
      };
      materialize_lessons: {
        Args: { p_student_id: string; p_weeks?: number };
        Returns: number;
      };
      materialize_points: {
        Args: {
          p_book_id: string;
          p_first_point: number;
          p_last_point: number;
        };
        Returns: number;
      };
      my_open_organization_invites: {
        Args: Record<PropertyKey, never>;
        Returns: {
          expires_at: string;
          has_teacher: boolean;
          id: string;
          organization_id: string;
          organization_name: string;
          role: Database["public"]["Enums"]["organization_role"];
        }[];
      };
      pgp_armor_headers: {
        Args: { "": string };
        Returns: Record<string, unknown>[];
      };
      reorder_questions: {
        Args: { p_ids: string[]; p_point_id: string };
        Returns: undefined;
      };
      save_contrast_set: {
        Args: { p_expected?: string[]; p_items: string[]; p_set_id?: string };
        Returns: string;
      };
      submit_lead: {
        Args: {
          codigo_origem?: string;
          interesse: string;
          nivel?: string;
          nome: string;
          objetivo?: string;
          user_agent?: string;
          utm_campaign?: string;
          utm_medium?: string;
          utm_source?: string;
          whatsapp: string;
        };
        Returns: undefined;
      };
      teaches_anywhere: { Args: Record<PropertyKey, never>; Returns: boolean };
      teaches_in: { Args: { p_organization: string }; Returns: boolean };
      team_practice: {
        Args: { p_organization: string; p_weeks: number };
        Returns: {
          days_by_week: number[];
          last_practised_on: string;
          minutes_this_month: number;
          person_id: string;
        }[];
      };
    };
    Enums: {
      answer_language: "en" | "pt";
      attempt_verdict: "pending" | "correct" | "incorrect";
      block_kind:
        | "vocabulary"
        | "grammar_table"
        | "explanation"
        | "dictation"
        | "revision_exercise"
        | "chart_ref";
      image_style: "flat" | "realistic";
      lesson_status: "scheduled" | "done" | "cancelled" | "no_show";
      organization_role: "admin" | "teacher" | "student";
      representation_kind:
        | "photo"
        | "symbol"
        | "figure"
        | "action"
        | "pose"
        | "usage"
        | "metalanguage"
        | "none";
      word_class:
        | "noun"
        | "verb"
        | "adjective"
        | "adverb"
        | "pronoun"
        | "preposition"
        | "determiner"
        | "conjunction"
        | "numeral"
        | "question_word"
        | "interjection"
        | "phrase";
    };
    CompositeTypes: {
      [_ in never]: never;
    };
  };
};

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">;

type DefaultSchema = DatabaseWithoutInternals[Extract<
  keyof Database,
  "public"
>];

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R;
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R;
      }
      ? R
      : never
    : never;

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    keyof DefaultSchema["Tables"] | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I;
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I;
      }
      ? I
      : never
    : never;

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    keyof DefaultSchema["Tables"] | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U;
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U;
      }
      ? U
      : never
    : never;

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    keyof DefaultSchema["Enums"] | { schema: keyof DatabaseWithoutInternals },
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never;

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never;

export const Constants = {
  public: {
    Enums: {
      answer_language: ["en", "pt"],
      attempt_verdict: ["pending", "correct", "incorrect"],
      block_kind: [
        "vocabulary",
        "grammar_table",
        "explanation",
        "dictation",
        "revision_exercise",
        "chart_ref",
      ],
      image_style: ["flat", "realistic"],
      lesson_status: ["scheduled", "done", "cancelled", "no_show"],
      organization_role: ["admin", "teacher", "student"],
      representation_kind: [
        "photo",
        "symbol",
        "figure",
        "action",
        "pose",
        "usage",
        "metalanguage",
        "none",
      ],
      word_class: [
        "noun",
        "verb",
        "adjective",
        "adverb",
        "pronoun",
        "preposition",
        "determiner",
        "conjunction",
        "numeral",
        "question_word",
        "interjection",
        "phrase",
      ],
    },
  },
} as const;
