/**
 * Generated from the migrations in supabase/migrations, not from the deployed
 * project, so the types describe the schema this repository defines.
 *
 * Regenerate after adding a migration:
 *   supabase gen types typescript --db-url "<url>" --schema public \
 *     > src/lib/supabase/types.ts
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
        };
        Insert: {
          assignment_id: string;
          id?: string;
          position: number;
          question_id: string;
        };
        Update: {
          assignment_id?: string;
          id?: string;
          position?: number;
          question_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "assignment_items_assignment_id_fkey";
            columns: ["assignment_id"];
            isOneToOne: false;
            referencedRelation: "assignments";
            referencedColumns: ["id"];
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
          student_id: string;
        };
        Insert: {
          completed_at?: string | null;
          created_at?: string;
          due_on: string;
          id?: string;
          student_id: string;
        };
        Update: {
          completed_at?: string | null;
          created_at?: string;
          due_on?: string;
          id?: string;
          student_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "assignments_student_id_fkey";
            columns: ["student_id"];
            isOneToOne: false;
            referencedRelation: "students";
            referencedColumns: ["id"];
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
            foreignKeyName: "attempts_student_id_fkey";
            columns: ["student_id"];
            isOneToOne: false;
            referencedRelation: "students";
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
          start_time?: string;
          student_id?: string;
          timezone?: string;
          weekday?: number;
        };
        Relationships: [
          {
            foreignKeyName: "lesson_schedules_student_id_fkey";
            columns: ["student_id"];
            isOneToOne: false;
            referencedRelation: "students";
            referencedColumns: ["id"];
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
          status?: Database["public"]["Enums"]["lesson_status"];
          student_id?: string;
          teacher_note?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "lessons_student_id_fkey";
            columns: ["student_id"];
            isOneToOne: false;
            referencedRelation: "students";
            referencedColumns: ["id"];
          },
        ];
      };
      profiles: {
        Row: {
          created_at: string;
          full_name: string;
          id: string;
          role: Database["public"]["Enums"]["user_role"];
          timezone: string;
        };
        Insert: {
          created_at?: string;
          full_name: string;
          id: string;
          role?: Database["public"]["Enums"]["user_role"];
          timezone?: string;
        };
        Update: {
          created_at?: string;
          full_name?: string;
          id?: string;
          role?: Database["public"]["Enums"]["user_role"];
          timezone?: string;
        };
        Relationships: [];
      };
      questions: {
        Row: {
          created_at: string;
          expected_answer: string;
          id: string;
          image_path: string | null;
          is_published: boolean;
          position: number;
          prompt: string;
          prompt_audio_path: string | null;
          stage_id: string;
        };
        Insert: {
          created_at?: string;
          expected_answer: string;
          id?: string;
          image_path?: string | null;
          is_published?: boolean;
          position: number;
          prompt: string;
          prompt_audio_path?: string | null;
          stage_id: string;
        };
        Update: {
          created_at?: string;
          expected_answer?: string;
          id?: string;
          image_path?: string | null;
          is_published?: boolean;
          position?: number;
          prompt?: string;
          prompt_audio_path?: string | null;
          stage_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "questions_stage_id_fkey";
            columns: ["stage_id"];
            isOneToOne: false;
            referencedRelation: "stages";
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
          student_id: string;
        };
        Insert: {
          due_on?: string;
          ease?: number;
          interval_days?: number;
          question_id: string;
          repetitions?: number;
          student_id: string;
        };
        Update: {
          due_on?: string;
          ease?: number;
          interval_days?: number;
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
            foreignKeyName: "review_schedule_student_id_fkey";
            columns: ["student_id"];
            isOneToOne: false;
            referencedRelation: "students";
            referencedColumns: ["id"];
          },
        ];
      };
      stages: {
        Row: {
          created_at: string;
          grammar_targets: string[];
          id: string;
          name: string;
          position: number;
          vocabulary_targets: string[];
        };
        Insert: {
          created_at?: string;
          grammar_targets?: string[];
          id?: string;
          name: string;
          position: number;
          vocabulary_targets?: string[];
        };
        Update: {
          created_at?: string;
          grammar_targets?: string[];
          id?: string;
          name?: string;
          position?: number;
          vocabulary_targets?: string[];
        };
        Relationships: [];
      };
      students: {
        Row: {
          current_stage_id: string | null;
          id: string;
          is_active: boolean;
          meet_url: string | null;
          started_on: string | null;
        };
        Insert: {
          current_stage_id?: string | null;
          id: string;
          is_active?: boolean;
          meet_url?: string | null;
          started_on?: string | null;
        };
        Update: {
          current_stage_id?: string | null;
          id?: string;
          is_active?: boolean;
          meet_url?: string | null;
          started_on?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "students_current_stage_id_fkey";
            columns: ["current_stage_id"];
            isOneToOne: false;
            referencedRelation: "stages";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "students_id_fkey";
            columns: ["id"];
            isOneToOne: true;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
    };
    Views: {
      [_ in never]: never;
    };
    Functions: {
      dearmor: { Args: { "": string }; Returns: string };
      gen_random_uuid: { Args: never; Returns: string };
      gen_salt: { Args: { "": string }; Returns: string };
      is_teacher: { Args: never; Returns: boolean };
      materialize_lessons: {
        Args: { p_student_id: string; p_weeks?: number };
        Returns: number;
      };
      pgp_armor_headers: {
        Args: { "": string };
        Returns: Record<string, unknown>[];
      };
    };
    Enums: {
      attempt_verdict: "pending" | "correct" | "incorrect";
      lesson_status: "scheduled" | "done" | "cancelled" | "no_show";
      user_role: "student" | "teacher";
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
      attempt_verdict: ["pending", "correct", "incorrect"],
      lesson_status: ["scheduled", "done", "cancelled", "no_show"],
      user_role: ["student", "teacher"],
    },
  },
} as const;
