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
          position: number;
          question_id: string;
          school_id: string;
        };
        Insert: {
          assignment_id: string;
          id?: string;
          position: number;
          question_id: string;
          school_id: string;
        };
        Update: {
          assignment_id?: string;
          id?: string;
          position?: number;
          question_id?: string;
          school_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "assignment_items_assignment_fkey";
            columns: ["school_id", "assignment_id"];
            isOneToOne: false;
            referencedRelation: "assignments";
            referencedColumns: ["school_id", "id"];
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
          school_id: string;
          student_id: string;
        };
        Insert: {
          completed_at?: string | null;
          created_at?: string;
          due_on: string;
          id?: string;
          school_id: string;
          student_id: string;
        };
        Update: {
          completed_at?: string | null;
          created_at?: string;
          due_on?: string;
          id?: string;
          school_id?: string;
          student_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "assignments_student_fkey";
            columns: ["school_id", "student_id"];
            isOneToOne: false;
            referencedRelation: "students";
            referencedColumns: ["school_id", "id"];
          },
        ];
      };
      attempts: {
        Row: {
          assignment_item_id: string | null;
          audio_path: string;
          created_at: string;
          id: string;
          question_id: string;
          reviewed_at: string | null;
          reviewed_by: string | null;
          school_id: string;
          student_id: string;
          teacher_note: string | null;
          transcript: string | null;
          verdict: Database["public"]["Enums"]["attempt_verdict"];
        };
        Insert: {
          assignment_item_id?: string | null;
          audio_path: string;
          created_at?: string;
          id?: string;
          question_id: string;
          reviewed_at?: string | null;
          reviewed_by?: string | null;
          school_id: string;
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
          question_id?: string;
          reviewed_at?: string | null;
          reviewed_by?: string | null;
          school_id?: string;
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
            columns: ["school_id", "student_id"];
            isOneToOne: false;
            referencedRelation: "students";
            referencedColumns: ["school_id", "id"];
          },
        ];
      };
      blocks: {
        Row: {
          based_on_id: string | null;
          content: string;
          created_at: string;
          id: string;
          kind: Database["public"]["Enums"]["block_kind"];
          needs_review: boolean;
          point_id: string;
          position: number;
          school_id: string | null;
          source_page: string | null;
        };
        Insert: {
          based_on_id?: string | null;
          content: string;
          created_at?: string;
          id?: string;
          kind: Database["public"]["Enums"]["block_kind"];
          needs_review?: boolean;
          point_id: string;
          position: number;
          school_id?: string | null;
          source_page?: string | null;
        };
        Update: {
          based_on_id?: string | null;
          content?: string;
          created_at?: string;
          id?: string;
          kind?: Database["public"]["Enums"]["block_kind"];
          needs_review?: boolean;
          point_id?: string;
          position?: number;
          school_id?: string | null;
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
            foreignKeyName: "blocks_point_id_fkey";
            columns: ["point_id"];
            isOneToOne: false;
            referencedRelation: "points";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "blocks_school_id_fkey";
            columns: ["school_id"];
            isOneToOne: false;
            referencedRelation: "schools";
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
          position: number;
          school_id: string | null;
          title: string;
        };
        Insert: {
          based_on_id?: string | null;
          created_at?: string;
          first_point?: number | null;
          id?: string;
          last_point?: number | null;
          position: number;
          school_id?: string | null;
          title: string;
        };
        Update: {
          based_on_id?: string | null;
          created_at?: string;
          first_point?: number | null;
          id?: string;
          last_point?: number | null;
          position?: number;
          school_id?: string | null;
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
            foreignKeyName: "books_school_id_fkey";
            columns: ["school_id"];
            isOneToOne: false;
            referencedRelation: "schools";
            referencedColumns: ["id"];
          },
        ];
      };
      contrast_set_items: {
        Row: {
          position: number;
          school_id: string | null;
          set_id: string;
          vocabulary_item_id: string;
        };
        Insert: {
          position: number;
          school_id?: string | null;
          set_id: string;
          vocabulary_item_id: string;
        };
        Update: {
          position?: number;
          school_id?: string | null;
          set_id?: string;
          vocabulary_item_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "contrast_set_items_school_id_fkey";
            columns: ["school_id"];
            isOneToOne: false;
            referencedRelation: "schools";
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
          school_id: string | null;
        };
        Insert: {
          based_on_id?: string | null;
          created_at?: string;
          id?: string;
          school_id?: string | null;
        };
        Update: {
          based_on_id?: string | null;
          created_at?: string;
          id?: string;
          school_id?: string | null;
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
            foreignKeyName: "contrast_sets_school_id_fkey";
            columns: ["school_id"];
            isOneToOne: false;
            referencedRelation: "schools";
            referencedColumns: ["id"];
          },
        ];
      };
      image_attempts: {
        Row: {
          completed_at: string | null;
          created_at: string;
          credits_spent: number | null;
          decided_at: string | null;
          error: string | null;
          id: string;
          model: string | null;
          prompt: string | null;
          provider: string;
          provider_request_id: string | null;
          reference_path: string | null;
          school_id: string | null;
          source_filename: string | null;
          status: string;
          storage_path: string | null;
          subject: string | null;
          vocabulary_item_id: string;
        };
        Insert: {
          completed_at?: string | null;
          created_at?: string;
          credits_spent?: number | null;
          decided_at?: string | null;
          error?: string | null;
          id?: string;
          model?: string | null;
          prompt?: string | null;
          provider: string;
          provider_request_id?: string | null;
          reference_path?: string | null;
          school_id?: string | null;
          source_filename?: string | null;
          status: string;
          storage_path?: string | null;
          subject?: string | null;
          vocabulary_item_id: string;
        };
        Update: {
          completed_at?: string | null;
          created_at?: string;
          credits_spent?: number | null;
          decided_at?: string | null;
          error?: string | null;
          id?: string;
          model?: string | null;
          prompt?: string | null;
          provider?: string;
          provider_request_id?: string | null;
          reference_path?: string | null;
          school_id?: string | null;
          source_filename?: string | null;
          status?: string;
          storage_path?: string | null;
          subject?: string | null;
          vocabulary_item_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "image_attempts_school_id_fkey";
            columns: ["school_id"];
            isOneToOne: false;
            referencedRelation: "schools";
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
      lesson_schedules: {
        Row: {
          created_at: string;
          duration_minutes: number;
          id: string;
          is_active: boolean;
          school_id: string;
          start_time: string;
          student_id: string;
          timezone: string;
          weekday: number;
        };
        Insert: {
          created_at?: string;
          duration_minutes?: number;
          id?: string;
          is_active?: boolean;
          school_id: string;
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
          school_id?: string;
          start_time?: string;
          student_id?: string;
          timezone?: string;
          weekday?: number;
        };
        Relationships: [
          {
            foreignKeyName: "lesson_schedules_student_fkey";
            columns: ["school_id", "student_id"];
            isOneToOne: false;
            referencedRelation: "students";
            referencedColumns: ["school_id", "id"];
          },
        ];
      };
      lessons: {
        Row: {
          created_at: string;
          duration_minutes: number;
          id: string;
          meet_url: string | null;
          scheduled_at: string;
          school_id: string;
          status: Database["public"]["Enums"]["lesson_status"];
          student_id: string;
          teacher_note: string | null;
        };
        Insert: {
          created_at?: string;
          duration_minutes?: number;
          id?: string;
          meet_url?: string | null;
          scheduled_at: string;
          school_id: string;
          status?: Database["public"]["Enums"]["lesson_status"];
          student_id: string;
          teacher_note?: string | null;
        };
        Update: {
          created_at?: string;
          duration_minutes?: number;
          id?: string;
          meet_url?: string | null;
          scheduled_at?: string;
          school_id?: string;
          status?: Database["public"]["Enums"]["lesson_status"];
          student_id?: string;
          teacher_note?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "lessons_student_fkey";
            columns: ["school_id", "student_id"];
            isOneToOne: false;
            referencedRelation: "students";
            referencedColumns: ["school_id", "id"];
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
          school_id: string | null;
        };
        Insert: {
          based_on_id?: string | null;
          book_id: string;
          created_at?: string;
          first_point: number;
          id?: string;
          last_point: number;
          number: number;
          school_id?: string | null;
        };
        Update: {
          based_on_id?: string | null;
          book_id?: string;
          created_at?: string;
          first_point?: number;
          id?: string;
          last_point?: number;
          number?: number;
          school_id?: string | null;
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
            foreignKeyName: "lessons_content_school_id_fkey";
            columns: ["school_id"];
            isOneToOne: false;
            referencedRelation: "schools";
            referencedColumns: ["id"];
          },
        ];
      };
      platform_admins: {
        Row: {
          created_at: string;
          user_id: string;
        };
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
          school_id: string | null;
        };
        Insert: {
          based_on_id?: string | null;
          book_id: string;
          created_at?: string;
          filled_at?: string | null;
          id?: string;
          lesson_content_id?: string | null;
          number: number;
          school_id?: string | null;
        };
        Update: {
          based_on_id?: string | null;
          book_id?: string;
          created_at?: string;
          filled_at?: string | null;
          id?: string;
          lesson_content_id?: string | null;
          number?: number;
          school_id?: string | null;
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
            foreignKeyName: "points_school_id_fkey";
            columns: ["school_id"];
            isOneToOne: false;
            referencedRelation: "schools";
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
          is_published: boolean;
          point_id: string;
          position: number;
          prompt: string;
          prompt_audio_path: string | null;
          school_id: string | null;
          shown_vocabulary_item_id: string | null;
        };
        Insert: {
          answer_language?: Database["public"]["Enums"]["answer_language"];
          based_on_id?: string | null;
          created_at?: string;
          expected_answer: string;
          id?: string;
          image_path?: string | null;
          is_published?: boolean;
          point_id: string;
          position: number;
          prompt: string;
          prompt_audio_path?: string | null;
          school_id?: string | null;
          shown_vocabulary_item_id?: string | null;
        };
        Update: {
          answer_language?: Database["public"]["Enums"]["answer_language"];
          based_on_id?: string | null;
          created_at?: string;
          expected_answer?: string;
          id?: string;
          image_path?: string | null;
          is_published?: boolean;
          point_id?: string;
          position?: number;
          prompt?: string;
          prompt_audio_path?: string | null;
          school_id?: string | null;
          shown_vocabulary_item_id?: string | null;
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
            foreignKeyName: "questions_point_id_fkey";
            columns: ["point_id"];
            isOneToOne: false;
            referencedRelation: "points";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "questions_school_id_fkey";
            columns: ["school_id"];
            isOneToOne: false;
            referencedRelation: "schools";
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
          question_id: string;
          repetitions: number;
          school_id: string;
          student_id: string;
        };
        Insert: {
          due_on?: string;
          ease?: number;
          interval_days?: number;
          question_id: string;
          repetitions?: number;
          school_id: string;
          student_id: string;
        };
        Update: {
          due_on?: string;
          ease?: number;
          interval_days?: number;
          question_id?: string;
          repetitions?: number;
          school_id?: string;
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
            columns: ["school_id", "student_id"];
            isOneToOne: false;
            referencedRelation: "students";
            referencedColumns: ["school_id", "id"];
          },
        ];
      };
      school_members: {
        Row: {
          created_at: string;
          role: Database["public"]["Enums"]["school_role"];
          school_id: string;
          user_id: string;
        };
        Insert: {
          created_at?: string;
          role: Database["public"]["Enums"]["school_role"];
          school_id: string;
          user_id: string;
        };
        Update: {
          created_at?: string;
          role?: Database["public"]["Enums"]["school_role"];
          school_id?: string;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "school_members_school_id_fkey";
            columns: ["school_id"];
            isOneToOne: false;
            referencedRelation: "schools";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "school_members_user_id_fkey";
            columns: ["user_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      schools: {
        Row: {
          created_at: string;
          id: string;
          name: string;
          slug: string;
        };
        Insert: {
          created_at?: string;
          id?: string;
          name: string;
          slug: string;
        };
        Update: {
          created_at?: string;
          id?: string;
          name?: string;
          slug?: string;
        };
        Relationships: [];
      };
      students: {
        Row: {
          id: string;
          is_active: boolean;
          meet_url: string | null;
          school_id: string;
          started_on: string | null;
        };
        Insert: {
          id: string;
          is_active?: boolean;
          meet_url?: string | null;
          school_id: string;
          started_on?: string | null;
        };
        Update: {
          id?: string;
          is_active?: boolean;
          meet_url?: string | null;
          school_id?: string;
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
            foreignKeyName: "students_school_id_fkey";
            columns: ["school_id"];
            isOneToOne: false;
            referencedRelation: "schools";
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
          reference_path: string | null;
          representation:
            Database["public"]["Enums"]["representation_kind"] | null;
          school_id: string | null;
          suggested_representation:
            Database["public"]["Enums"]["representation_kind"] | null;
          suggestion_run_id: string | null;
          term: string;
          word_class: Database["public"]["Enums"]["word_class"] | null;
        };
        Insert: {
          approved_attempt_id?: string | null;
          based_on_id?: string | null;
          created_at?: string;
          first_point_id: string;
          id?: string;
          image_path?: string | null;
          image_style?: Database["public"]["Enums"]["image_style"];
          image_subject?: string | null;
          reference_path?: string | null;
          representation?:
            Database["public"]["Enums"]["representation_kind"] | null;
          school_id?: string | null;
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
          reference_path?: string | null;
          representation?:
            Database["public"]["Enums"]["representation_kind"] | null;
          school_id?: string | null;
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
            foreignKeyName: "vocabulary_items_school_id_fkey";
            columns: ["school_id"];
            isOneToOne: false;
            referencedRelation: "schools";
            referencedColumns: ["id"];
          },
        ];
      };
    };
    Views: {
      [_ in never]: never;
    };
    Functions: {
      approve_image_attempt: {
        Args: { p_attempt: string };
        Returns: undefined;
      };
      belongs_anywhere: { Args: Record<PropertyKey, never>; Returns: boolean };
      can_write_content: { Args: { p_school: string }; Returns: boolean };
      clear_word_representation: {
        Args: {
          p_kind: Database["public"]["Enums"]["representation_kind"];
          p_word: string;
        };
        Returns: undefined;
      };
      dearmor: { Args: { "": string }; Returns: string };
      delete_question: { Args: { p_question_id: string }; Returns: undefined };
      dissolve_contrast_set: { Args: { p_set_id: string }; Returns: undefined };
      gen_random_uuid: { Args: Record<PropertyKey, never>; Returns: string };
      gen_salt: { Args: { "": string }; Returns: string };
      is_platform_admin: { Args: Record<PropertyKey, never>; Returns: boolean };
      is_school_member: {
        Args: {
          p_roles?: Database["public"]["Enums"]["school_role"][];
          p_school: string;
        };
        Returns: boolean;
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
      teaches_anywhere: { Args: Record<PropertyKey, never>; Returns: boolean };
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
      representation_kind:
        | "photo"
        | "symbol"
        | "figure"
        | "action"
        | "pose"
        | "usage"
        | "metalanguage"
        | "none";
      school_role: "admin" | "teacher" | "student";
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
      school_role: ["admin", "teacher", "student"],
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
