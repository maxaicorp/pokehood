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
    PostgrestVersion: "14.1"
  }
  public: {
    Tables: {
      card_stats: {
        Row: {
          collection_add_count: number
          image_small: string
          name: string
          search_hit_count: number
          set_name: string
          tcg_api_id: string
          updated_at: string
          view_count: number
          wishlist_add_count: number
        }
        Insert: {
          collection_add_count?: number
          image_small?: string
          name?: string
          search_hit_count?: number
          set_name?: string
          tcg_api_id: string
          updated_at?: string
          view_count?: number
          wishlist_add_count?: number
        }
        Update: {
          collection_add_count?: number
          image_small?: string
          name?: string
          search_hit_count?: number
          set_name?: string
          tcg_api_id?: string
          updated_at?: string
          view_count?: number
          wishlist_add_count?: number
        }
        Relationships: []
      }
      collection_cards: {
        Row: {
          added_at: string
          card_number: string
          condition: string
          for_sale: boolean
          id: string
          image_large: string
          image_small: string
          manual_price: number | null
          market_price: number | null
          name: string
          quantity: number
          rarity: string
          sale_price: number | null
          set_id: string
          set_name: string
          tcg_api_id: string
          user_id: string
        }
        Insert: {
          added_at?: string
          card_number: string
          condition?: string
          for_sale?: boolean
          id?: string
          image_large: string
          image_small: string
          manual_price?: number | null
          market_price?: number | null
          name: string
          quantity?: number
          rarity?: string
          sale_price?: number | null
          set_id: string
          set_name: string
          tcg_api_id: string
          user_id: string
        }
        Update: {
          added_at?: string
          card_number?: string
          condition?: string
          for_sale?: boolean
          id?: string
          image_large?: string
          image_small?: string
          manual_price?: number | null
          market_price?: number | null
          name?: string
          quantity?: number
          rarity?: string
          sale_price?: number | null
          set_id?: string
          set_name?: string
          tcg_api_id?: string
          user_id?: string
        }
        Relationships: []
      }
      game_card_pool: {
        Row: {
          added_at: string
          card_id: string
          image_small: string
          name: string
        }
        Insert: {
          added_at?: string
          card_id: string
          image_small: string
          name: string
        }
        Update: {
          added_at?: string
          card_id?: string
          image_small?: string
          name?: string
        }
        Relationships: []
      }
      game_sessions: {
        Row: {
          completed_at: string | null
          flips_count: number
          game: string
          id: string
          last_flip_at: string | null
          matched_slots: number[]
          pending_flip: number | null
          period_key: string | null
          score: number | null
          slots: Json
          started_at: string
          status: string
          user_id: string
          wrong_flips: number
        }
        Insert: {
          completed_at?: string | null
          flips_count?: number
          game?: string
          id?: string
          last_flip_at?: string | null
          matched_slots?: number[]
          pending_flip?: number | null
          period_key?: string | null
          score?: number | null
          slots: Json
          started_at?: string
          status?: string
          user_id: string
          wrong_flips?: number
        }
        Update: {
          completed_at?: string | null
          flips_count?: number
          game?: string
          id?: string
          last_flip_at?: string | null
          matched_slots?: number[]
          pending_flip?: number | null
          period_key?: string | null
          score?: number | null
          slots?: Json
          started_at?: string
          status?: string
          user_id?: string
          wrong_flips?: number
        }
        Relationships: []
      }
      link_clicks: {
        Row: {
          clicked_at: string
          id: string
          link_id: string
          link_user_id: string
        }
        Insert: {
          clicked_at?: string
          id?: string
          link_id: string
          link_user_id: string
        }
        Update: {
          clicked_at?: string
          id?: string
          link_id?: string
          link_user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "link_clicks_link_id_fkey"
            columns: ["link_id"]
            isOneToOne: false
            referencedRelation: "user_links"
            referencedColumns: ["id"]
          },
        ]
      }
      price_snapshots: {
        Row: {
          card_id: string
          card_name: string
          id: string
          price: number
          recorded_at: string
          set_name: string
        }
        Insert: {
          card_id: string
          card_name?: string
          id?: string
          price: number
          recorded_at?: string
          set_name?: string
        }
        Update: {
          card_id?: string
          card_name?: string
          id?: string
          price?: number
          recorded_at?: string
          set_name?: string
        }
        Relationships: []
      }
      prize_winners: {
        Row: {
          admin_notes: string | null
          announced_at: string
          carrier: string | null
          claimed_at: string | null
          delivered_at: string | null
          id: string
          prize_id: string
          ship_to: Json | null
          shipped_at: string | null
          tracking_number: string | null
          tracking_url: string | null
          user_id: string
          winning_score: number
        }
        Insert: {
          admin_notes?: string | null
          announced_at?: string
          carrier?: string | null
          claimed_at?: string | null
          delivered_at?: string | null
          id?: string
          prize_id: string
          ship_to?: Json | null
          shipped_at?: string | null
          tracking_number?: string | null
          tracking_url?: string | null
          user_id: string
          winning_score: number
        }
        Update: {
          admin_notes?: string | null
          announced_at?: string
          carrier?: string | null
          claimed_at?: string | null
          delivered_at?: string | null
          id?: string
          prize_id?: string
          ship_to?: Json | null
          shipped_at?: string | null
          tracking_number?: string | null
          tracking_url?: string | null
          user_id?: string
          winning_score?: number
        }
        Relationships: [
          {
            foreignKeyName: "prize_winners_prize_id_fkey"
            columns: ["prize_id"]
            isOneToOne: true
            referencedRelation: "prizes"
            referencedColumns: ["id"]
          },
        ]
      }
      prizes: {
        Row: {
          created_at: string
          created_by: string
          description: string | null
          estimated_value_usd: number | null
          game: string
          id: string
          image_url: string | null
          status: string
          title: string
          week_end: string
          week_start: string
        }
        Insert: {
          created_at?: string
          created_by: string
          description?: string | null
          estimated_value_usd?: number | null
          game?: string
          id?: string
          image_url?: string | null
          status?: string
          title: string
          week_end: string
          week_start: string
        }
        Update: {
          created_at?: string
          created_by?: string
          description?: string | null
          estimated_value_usd?: number | null
          game?: string
          id?: string
          image_url?: string | null
          status?: string
          title?: string
          week_end?: string
          week_start?: string
        }
        Relationships: []
      }
      profile_views: {
        Row: {
          id: string
          profile_user_id: string
          viewed_at: string
        }
        Insert: {
          id?: string
          profile_user_id: string
          viewed_at?: string
        }
        Update: {
          id?: string
          profile_user_id?: string
          viewed_at?: string
        }
        Relationships: []
      }
      profiles: {
        Row: {
          avatar_url: string | null
          bio: string | null
          created_at: string
          display_name: string | null
          id: string
          is_published: boolean
          slug: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          avatar_url?: string | null
          bio?: string | null
          created_at?: string
          display_name?: string | null
          id?: string
          is_published?: boolean
          slug?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          avatar_url?: string | null
          bio?: string | null
          created_at?: string
          display_name?: string | null
          id?: string
          is_published?: boolean
          slug?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      set_sentiment_votes: {
        Row: {
          card_id: string
          created_at: string
          id: string
          updated_at: string
          user_id: string
          vote_type: Database["public"]["Enums"]["set_sentiment_vote"]
        }
        Insert: {
          card_id: string
          created_at?: string
          id?: string
          updated_at?: string
          user_id: string
          vote_type: Database["public"]["Enums"]["set_sentiment_vote"]
        }
        Update: {
          card_id?: string
          created_at?: string
          id?: string
          updated_at?: string
          user_id?: string
          vote_type?: Database["public"]["Enums"]["set_sentiment_vote"]
        }
        Relationships: []
      }
      user_links: {
        Row: {
          created_at: string
          id: string
          label: string
          sort_order: number
          url: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          label: string
          sort_order?: number
          url: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          label?: string
          sort_order?: number
          url?: string
          user_id?: string
        }
        Relationships: []
      }
      user_roles: {
        Row: {
          id: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Insert: {
          id?: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id?: string
        }
        Relationships: []
      }
      wishlist_cards: {
        Row: {
          added_at: string
          card_number: string
          id: string
          image_large: string
          image_small: string
          market_price: number | null
          name: string
          rarity: string
          set_id: string
          set_name: string
          tcg_api_id: string
          user_id: string
          wishlist_id: string
        }
        Insert: {
          added_at?: string
          card_number: string
          id?: string
          image_large: string
          image_small: string
          market_price?: number | null
          name: string
          rarity?: string
          set_id: string
          set_name: string
          tcg_api_id: string
          user_id: string
          wishlist_id: string
        }
        Update: {
          added_at?: string
          card_number?: string
          id?: string
          image_large?: string
          image_small?: string
          market_price?: number | null
          name?: string
          rarity?: string
          set_id?: string
          set_name?: string
          tcg_api_id?: string
          user_id?: string
          wishlist_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "wishlist_cards_wishlist_id_fkey"
            columns: ["wishlist_id"]
            isOneToOne: false
            referencedRelation: "wishlists"
            referencedColumns: ["id"]
          },
        ]
      }
      wishlists: {
        Row: {
          created_at: string
          id: string
          name: string
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          name?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          name?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      current_week_start: { Args: never; Returns: string }
      get_game_leaderboard: {
        Args: { p_end: string; p_game: string; p_start: string }
        Returns: {
          completed_at: string
          rank: number
          score: number
          user_id: string
          username: string
        }[]
      }
      get_my_game_stats: { Args: { p_game: string }; Returns: Json }
      get_set_sentiment: {
        Args: { p_set_ids: string[] }
        Returns: {
          current_user_vote: Database["public"]["Enums"]["set_sentiment_vote"]
          downvotes: number
          score: number
          set_id: string
          upvotes: number
        }[]
      }
      get_unclaimed_wins: {
        Args: never
        Returns: {
          announced_at: string
          description: string
          image_url: string
          prize_id: string
          prize_winner_id: string
          title: string
          winning_score: number
        }[]
      }
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
      increment_card_stat: {
        Args: {
          p_image_small: string
          p_name: string
          p_set_name: string
          p_stat: string
          p_tcg_api_id: string
        }
        Returns: undefined
      }
    }
    Enums: {
      app_role: "admin" | "moderator" | "user"
      set_sentiment_vote: "up" | "down"
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
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
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
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
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
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
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
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
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
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
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
      app_role: ["admin", "moderator", "user"],
      set_sentiment_vote: ["up", "down"],
    },
  },
} as const
