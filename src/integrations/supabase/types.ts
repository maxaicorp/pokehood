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
      card_price_overrides: {
        Row: {
          card_id: string
          card_name: string
          note: string | null
          price: number
          price_1d: number | null
          price_30d: number | null
          price_7d: number | null
          set_at: string
          set_by: string | null
          set_name: string
        }
        Insert: {
          card_id: string
          card_name?: string
          note?: string | null
          price: number
          price_1d?: number | null
          price_30d?: number | null
          price_7d?: number | null
          set_at?: string
          set_by?: string | null
          set_name?: string
        }
        Update: {
          card_id?: string
          card_name?: string
          note?: string | null
          price?: number
          price_1d?: number | null
          price_30d?: number | null
          price_7d?: number | null
          set_at?: string
          set_by?: string | null
          set_name?: string
        }
        Relationships: []
      }
      card_stats: {
        Row: {
          collection_add_count: number
          image_small: string
          last_searched_at: string | null
          last_viewed_at: string | null
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
          last_searched_at?: string | null
          last_viewed_at?: string | null
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
          last_searched_at?: string | null
          last_viewed_at?: string | null
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
      cards: {
        Row: {
          hp: string | null
          id: string
          language: string
          name: string
          number: string
          rarity: string | null
          series: string | null
          set_id: string
          set_name: string
          subtypes: Json | null
          supertype: string | null
          types: Json | null
          updated_at: string
        }
        Insert: {
          hp?: string | null
          id: string
          language?: string
          name?: string
          number?: string
          rarity?: string | null
          series?: string | null
          set_id: string
          set_name?: string
          subtypes?: Json | null
          supertype?: string | null
          types?: Json | null
          updated_at?: string
        }
        Update: {
          hp?: string | null
          id?: string
          language?: string
          name?: string
          number?: string
          rarity?: string | null
          series?: string | null
          set_id?: string
          set_name?: string
          subtypes?: Json | null
          supertype?: string | null
          types?: Json | null
          updated_at?: string
        }
        Relationships: []
      }
      cc_discovery_results: {
        Row: {
          computed_at: string
          delta_pct: number | null
          listing_image: string | null
          listing_name: string | null
          listing_price_usd: number | null
          market_price_usd: number | null
          marketplace_url: string | null
          match_confidence: number | null
          match_method: string | null
          matched_card_id: string | null
          matched_card_name: string | null
          matched_company: string | null
          matched_grade: number | null
          matched_set_name: string | null
          pda_address: string
          status: string
          token_mint: string
        }
        Insert: {
          computed_at?: string
          delta_pct?: number | null
          listing_image?: string | null
          listing_name?: string | null
          listing_price_usd?: number | null
          market_price_usd?: number | null
          marketplace_url?: string | null
          match_confidence?: number | null
          match_method?: string | null
          matched_card_id?: string | null
          matched_card_name?: string | null
          matched_company?: string | null
          matched_grade?: number | null
          matched_set_name?: string | null
          pda_address: string
          status: string
          token_mint: string
        }
        Update: {
          computed_at?: string
          delta_pct?: number | null
          listing_image?: string | null
          listing_name?: string | null
          listing_price_usd?: number | null
          market_price_usd?: number | null
          marketplace_url?: string | null
          match_confidence?: number | null
          match_method?: string | null
          matched_card_id?: string | null
          matched_card_name?: string | null
          matched_company?: string | null
          matched_grade?: number | null
          matched_set_name?: string | null
          pda_address?: string
          status?: string
          token_mint?: string
        }
        Relationships: []
      }
      cc_discovery_state: {
        Row: {
          id: number
          last_error: string | null
          last_run_at: string | null
          matched_count: number
          status: string
          total_active: number
          undervalued_count: number
          unmatched_count: number
        }
        Insert: {
          id?: number
          last_error?: string | null
          last_run_at?: string | null
          matched_count?: number
          status?: string
          total_active?: number
          undervalued_count?: number
          unmatched_count?: number
        }
        Update: {
          id?: number
          last_error?: string | null
          last_run_at?: string | null
          matched_count?: number
          status?: string
          total_active?: number
          undervalued_count?: number
          unmatched_count?: number
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
          product_type: string
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
          product_type?: string
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
          product_type?: string
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
      giveaway_entries: {
        Row: {
          city: string
          confirmation_sent_at: string | null
          confirmation_token: string
          confirmed_at: string | null
          country: string
          created_at: string
          email: string
          full_name: string
          giveaway_id: string
          id: string
          ip_address: unknown
          state: string
          status: string
          street_address: string
          user_agent: string | null
          user_id: string | null
          zip: string
        }
        Insert: {
          city: string
          confirmation_sent_at?: string | null
          confirmation_token: string
          confirmed_at?: string | null
          country?: string
          created_at?: string
          email: string
          full_name: string
          giveaway_id: string
          id?: string
          ip_address?: unknown
          state: string
          status?: string
          street_address: string
          user_agent?: string | null
          user_id?: string | null
          zip: string
        }
        Update: {
          city?: string
          confirmation_sent_at?: string | null
          confirmation_token?: string
          confirmed_at?: string | null
          country?: string
          created_at?: string
          email?: string
          full_name?: string
          giveaway_id?: string
          id?: string
          ip_address?: unknown
          state?: string
          status?: string
          street_address?: string
          user_agent?: string | null
          user_id?: string | null
          zip?: string
        }
        Relationships: [
          {
            foreignKeyName: "giveaway_entries_giveaway_id_fkey"
            columns: ["giveaway_id"]
            isOneToOne: false
            referencedRelation: "giveaways"
            referencedColumns: ["id"]
          },
        ]
      }
      giveaways: {
        Row: {
          created_at: string
          created_by: string
          description: string | null
          ends_at: string
          estimated_value_usd: number | null
          id: string
          prize_image_url: string | null
          rules_text: string | null
          starts_at: string
          status: string
          title: string
          updated_at: string
          winner_entry_id: string | null
        }
        Insert: {
          created_at?: string
          created_by: string
          description?: string | null
          ends_at: string
          estimated_value_usd?: number | null
          id?: string
          prize_image_url?: string | null
          rules_text?: string | null
          starts_at: string
          status?: string
          title: string
          updated_at?: string
          winner_entry_id?: string | null
        }
        Update: {
          created_at?: string
          created_by?: string
          description?: string | null
          ends_at?: string
          estimated_value_usd?: number | null
          id?: string
          prize_image_url?: string | null
          rules_text?: string | null
          starts_at?: string
          status?: string
          title?: string
          updated_at?: string
          winner_entry_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "giveaways_winner_entry_fk"
            columns: ["winner_entry_id"]
            isOneToOne: false
            referencedRelation: "giveaway_entries"
            referencedColumns: ["id"]
          },
        ]
      }
      graded_price_snapshots: {
        Row: {
          card_id: string
          company: string
          currency: string
          grade: number
          high: number | null
          id: string
          is_error: boolean
          is_perfect: boolean
          is_signed: boolean
          low: number | null
          market: number | null
          mid: number | null
          recorded_at: string
        }
        Insert: {
          card_id: string
          company: string
          currency?: string
          grade: number
          high?: number | null
          id?: string
          is_error?: boolean
          is_perfect?: boolean
          is_signed?: boolean
          low?: number | null
          market?: number | null
          mid?: number | null
          recorded_at?: string
        }
        Update: {
          card_id?: string
          company?: string
          currency?: string
          grade?: number
          high?: number | null
          id?: string
          is_error?: boolean
          is_perfect?: boolean
          is_signed?: boolean
          low?: number | null
          market?: number | null
          mid?: number | null
          recorded_at?: string
        }
        Relationships: []
      }
      latest_card_prices: {
        Row: {
          card_id: string
          card_name: string
          price: number
          price_1d: number | null
          price_30d: number | null
          price_7d: number | null
          recorded_at: string
          set_name: string
          updated_at: string
        }
        Insert: {
          card_id: string
          card_name: string
          price: number
          price_1d?: number | null
          price_30d?: number | null
          price_7d?: number | null
          recorded_at: string
          set_name: string
          updated_at?: string
        }
        Update: {
          card_id?: string
          card_name?: string
          price?: number
          price_1d?: number | null
          price_30d?: number | null
          price_7d?: number | null
          recorded_at?: string
          set_name?: string
          updated_at?: string
        }
        Relationships: []
      }
      latest_graded_prices: {
        Row: {
          card_id: string
          company: string
          currency: string
          grade: number
          high: number | null
          low: number | null
          market: number | null
          mid: number | null
          updated_at: string
        }
        Insert: {
          card_id: string
          company: string
          currency?: string
          grade: number
          high?: number | null
          low?: number | null
          market?: number | null
          mid?: number | null
          updated_at?: string
        }
        Update: {
          card_id?: string
          company?: string
          currency?: string
          grade?: number
          high?: number | null
          low?: number | null
          market?: number | null
          mid?: number | null
          updated_at?: string
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
      nft_names: {
        Row: {
          attributes: Json | null
          card_name_attr: string | null
          card_number: string | null
          cert_number: string | null
          fetched_at: string
          grade_value: number | null
          grading_company: string | null
          mint: string
          name: string | null
          set_hint: string | null
          year_attr: string | null
        }
        Insert: {
          attributes?: Json | null
          card_name_attr?: string | null
          card_number?: string | null
          cert_number?: string | null
          fetched_at?: string
          grade_value?: number | null
          grading_company?: string | null
          mint: string
          name?: string | null
          set_hint?: string | null
          year_attr?: string | null
        }
        Update: {
          attributes?: Json | null
          card_name_attr?: string | null
          card_number?: string | null
          cert_number?: string | null
          fetched_at?: string
          grade_value?: number | null
          grading_company?: string | null
          mint?: string
          name?: string | null
          set_hint?: string | null
          year_attr?: string | null
        }
        Relationships: []
      }
      onchain_activities: {
        Row: {
          block_time: number
          buyer: string | null
          collection: string
          image: string | null
          ingested_at: string
          price: number | null
          price_info: Json | null
          price_usd: number | null
          seller: string | null
          signature: string
          source: string
          token_mint: string | null
          type: string
        }
        Insert: {
          block_time: number
          buyer?: string | null
          collection: string
          image?: string | null
          ingested_at?: string
          price?: number | null
          price_info?: Json | null
          price_usd?: number | null
          seller?: string | null
          signature: string
          source?: string
          token_mint?: string | null
          type: string
        }
        Update: {
          block_time?: number
          buyer?: string | null
          collection?: string
          image?: string | null
          ingested_at?: string
          price?: number | null
          price_info?: Json | null
          price_usd?: number | null
          seller?: string | null
          signature?: string
          source?: string
          token_mint?: string | null
          type?: string
        }
        Relationships: []
      }
      onchain_listings: {
        Row: {
          collection: string
          delisted_at: string | null
          first_seen_at: string
          image: string | null
          last_seen_at: string
          marketplace_url: string | null
          name: string | null
          pda_address: string
          price: number
          price_info: Json | null
          price_usd: number | null
          rarity_rank: number | null
          seller: string
          token_mint: string
        }
        Insert: {
          collection: string
          delisted_at?: string | null
          first_seen_at?: string
          image?: string | null
          last_seen_at?: string
          marketplace_url?: string | null
          name?: string | null
          pda_address: string
          price: number
          price_info?: Json | null
          price_usd?: number | null
          rarity_rank?: number | null
          seller: string
          token_mint: string
        }
        Update: {
          collection?: string
          delisted_at?: string | null
          first_seen_at?: string
          image?: string | null
          last_seen_at?: string
          marketplace_url?: string | null
          name?: string | null
          pda_address?: string
          price?: number
          price_info?: Json | null
          price_usd?: number | null
          rarity_rank?: number | null
          seller?: string
          token_mint?: string
        }
        Relationships: []
      }
      pipeline_heal_log: {
        Row: {
          actions: string[]
          coverage_pct_after: number | null
          coverage_pct_before: number | null
          credits_after: number | null
          credits_before: number | null
          credits_used: number | null
          delta_pct_after: number | null
          delta_pct_before: number | null
          id: string
          notes: string | null
          ran_at: string
          result: string
          subsystem: string
          trigger_failures: string[]
        }
        Insert: {
          actions?: string[]
          coverage_pct_after?: number | null
          coverage_pct_before?: number | null
          credits_after?: number | null
          credits_before?: number | null
          credits_used?: number | null
          delta_pct_after?: number | null
          delta_pct_before?: number | null
          id?: string
          notes?: string | null
          ran_at?: string
          result: string
          subsystem?: string
          trigger_failures?: string[]
        }
        Update: {
          actions?: string[]
          coverage_pct_after?: number | null
          coverage_pct_before?: number | null
          credits_after?: number | null
          credits_before?: number | null
          credits_used?: number | null
          delta_pct_after?: number | null
          delta_pct_before?: number | null
          id?: string
          notes?: string | null
          ran_at?: string
          result?: string
          subsystem?: string
          trigger_failures?: string[]
        }
        Relationships: []
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
      sealed_products: {
        Row: {
          description: string | null
          expansion_id: string | null
          expansion_logo: string | null
          expansion_name: string | null
          expansion_release_date: string | null
          expansion_series: string | null
          id: string
          image_medium: string | null
          image_small: string | null
          name: string
          type: string
          updated_at: string
          variants: Json | null
        }
        Insert: {
          description?: string | null
          expansion_id?: string | null
          expansion_logo?: string | null
          expansion_name?: string | null
          expansion_release_date?: string | null
          expansion_series?: string | null
          id: string
          image_medium?: string | null
          image_small?: string | null
          name: string
          type?: string
          updated_at?: string
          variants?: Json | null
        }
        Update: {
          description?: string | null
          expansion_id?: string | null
          expansion_logo?: string | null
          expansion_name?: string | null
          expansion_release_date?: string | null
          expansion_series?: string | null
          id?: string
          image_medium?: string | null
          image_small?: string | null
          name?: string
          type?: string
          updated_at?: string
          variants?: Json | null
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
      snapshot_chunk_log: {
        Row: {
          complete: boolean
          id: string
          page_limit: number
          pages_processed: number
          ran_at: string
          recorded_date: string
          start_page: number
          version: string | null
        }
        Insert: {
          complete?: boolean
          id?: string
          page_limit: number
          pages_processed?: number
          ran_at?: string
          recorded_date?: string
          start_page: number
          version?: string | null
        }
        Update: {
          complete?: boolean
          id?: string
          page_limit?: number
          pages_processed?: number
          ran_at?: string
          recorded_date?: string
          start_page?: number
          version?: string | null
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
      admin_clear_card_price_override: {
        Args: { p_card_id: string }
        Returns: undefined
      }
      admin_set_card_price: {
        Args: {
          p_card_id: string
          p_card_name?: string
          p_note?: string
          p_price: number
          p_price_1d?: number
          p_price_30d?: number
          p_price_7d?: number
          p_set_name?: string
        }
        Returns: undefined
      }
      current_week_start: { Args: never; Returns: string }
      get_all_latest_prices: {
        Args: { p_limit?: number; p_offset?: number }
        Returns: {
          card_id: string
          card_name: string
          price: number
          price_1d: number
          price_30d: number
          price_7d: number
          recorded_at: string
          set_name: string
        }[]
      }
      get_card_catalog: {
        Args: { p_limit?: number; p_offset?: number }
        Returns: {
          id: string
          name: string
          number: string
          rarity: string
          series: string
          set_id: string
          set_name: string
          supertype: string
        }[]
      }
      get_catalog_coverage: { Args: { p_min_gap?: number }; Returns: Json }
      get_cc_discovery: {
        Args: { p_limit?: number; p_offset?: number; p_status?: string }
        Returns: {
          computed_at: string
          delta_pct: number
          listing_image: string
          listing_name: string
          listing_price_usd: number
          market_price_usd: number
          marketplace_url: string
          match_confidence: number
          match_method: string
          matched_card_id: string
          matched_card_name: string
          matched_company: string
          matched_grade: number
          matched_set_name: string
          pda_address: string
          status: string
          token_mint: string
        }[]
      }
      get_cc_discovery_state: {
        Args: never
        Returns: {
          can_run_at: string
          last_error: string
          last_run_at: string
          matched_count: number
          status: string
          total_active: number
          undervalued_count: number
          unmatched_count: number
        }[]
      }
      get_filter_summary: {
        Args: { p_set_ids?: string[]; p_top_n?: number }
        Returns: {
          card_count: number
          total_value: number
        }[]
      }
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
      get_graded_tiles_for_card: {
        Args: { p_card_id: string }
        Returns: {
          company: string
          currency: string
          grade: number
          high: number
          low: number
          market: number
          mid: number
        }[]
      }
      get_latest_price_page: {
        Args: {
          p_include_sealed?: boolean
          p_limit?: number
          p_offset?: number
          p_set_ids?: string[]
          p_sort_dir?: string
        }
        Returns: {
          card_id: string
          card_name: string
          price: number
          price_1d: number
          price_30d: number
          price_7d: number
          recorded_at: string
          set_name: string
        }[]
      }
      get_my_game_stats: { Args: { p_game: string }; Returns: Json }
      get_onchain_activity: {
        Args: {
          p_collection?: string
          p_limit?: number
          p_offset?: number
          p_type?: string
        }
        Returns: {
          block_time: number
          buyer: string
          collection: string
          image: string
          name: string
          price: number
          price_info: Json
          price_usd: number
          seller: string
          signature: string
          source: string
          token_mint: string
          type: string
        }[]
      }
      get_onchain_health: { Args: never; Returns: Json }
      get_onchain_listings: {
        Args: {
          p_collection?: string
          p_limit?: number
          p_offset?: number
          p_sort?: string
        }
        Returns: {
          collection: string
          image: string
          marketplace_url: string
          name: string
          pda_address: string
          price: number
          price_info: Json
          price_usd: number
          rarity_rank: number
          seller: string
          token_mint: string
        }[]
      }
      get_onchain_top_sales: {
        Args: {
          p_collection?: string
          p_limit?: number
          p_min_usd?: number
          p_window_days?: number
        }
        Returns: {
          block_time: number
          buyer: string
          collection: string
          image: string
          name: string
          price: number
          price_info: Json
          price_usd: number
          seller: string
          signature: string
          source: string
          token_mint: string
          type: string
        }[]
      }
      get_pipeline_completeness: { Args: never; Returns: Json }
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
      get_top_movers: {
        Args: {
          p_limit?: number
          p_min_price?: number
          p_set_ids?: string[]
          p_window?: string
        }
        Returns: {
          card_id: string
          card_name: string
          price: number
          price_1d: number
          price_30d: number
          price_7d: number
          set_name: string
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
      heal_attempts_today: {
        Args: { p_action: string; p_subsystem: string }
        Returns: number
      }
      heal_repair_attempts_today: { Args: never; Returns: number }
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
      is_merch_name: { Args: { p_name: string }; Returns: boolean }
      refresh_latest_card_prices: { Args: never; Returns: number }
      refresh_latest_graded_prices: { Args: never; Returns: number }
      search_catalog: {
        Args: { p_limit?: number; p_query: string }
        Returns: {
          id: string
          image: string
          kind: string
          name: string
          score: number
          set_name: string
        }[]
      }
      show_limit: { Args: never; Returns: number }
      show_trgm: { Args: { "": string }; Returns: string[] }
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
