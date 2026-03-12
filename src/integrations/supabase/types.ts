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
          tcg_api_id: string
          name: string
          set_name: string
          image_small: string
          view_count: number
          search_hit_count: number
          collection_add_count: number
          wishlist_add_count: number
          last_viewed_at: string | null
          last_searched_at: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          tcg_api_id: string
          name: string
          set_name?: string
          image_small?: string
          view_count?: number
          search_hit_count?: number
          collection_add_count?: number
          wishlist_add_count?: number
          last_viewed_at?: string | null
          last_searched_at?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          tcg_api_id?: string
          name?: string
          set_name?: string
          image_small?: string
          view_count?: number
          search_hit_count?: number
          collection_add_count?: number
          wishlist_add_count?: number
          last_viewed_at?: string | null
          last_searched_at?: string | null
          created_at?: string
          updated_at?: string
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
      price_snapshots: {
        Row: {
          id: string
          card_id: string
          card_name: string
          set_name: string
          price: number
          recorded_at: string
        }
        Insert: {
          id?: string
          card_id: string
          card_name?: string
          set_name?: string
          price: number
          recorded_at?: string
        }
        Update: {
          id?: string
          card_id?: string
          card_name?: string
          set_name?: string
          price?: number
          recorded_at?: string
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
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
      increment_card_stat: {
        Args: {
          p_tcg_api_id: string
          p_name: string
          p_set_name: string
          p_image_small: string
          p_stat: string
        }
        Returns: undefined
      }
      get_price_changes: {
        Args: {
          p_card_ids: string[]
        }
        Returns: {
          card_id: string
          current_price: number | null
          price_1d_ago: number | null
          price_7d_ago: number | null
          price_30d_ago: number | null
        }[]
      }
    }
    Enums: {
      app_role: "admin" | "moderator" | "user"
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
    },
  },
} as const
