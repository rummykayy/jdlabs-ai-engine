export type View = 'setup' | 'login' | 'register' | 'community' | 'learn' | 'pricing' | 'contact' | 'privacy' | 'terms' | 'checkout' | 'orderSuccess' | 'history' | 'features';

export type ApiProvider = 'gemini';

export const InterviewMode = {
  VIDEO: 'Video Interview',
  AUDIO: 'Audio Interview',
  CHAT: 'Chat Interview',
  LIVE_SHARE: 'Live Share Interview',
} as const;

export type TInterviewMode = (typeof InterviewMode)[keyof typeof InterviewMode];
export type InterviewDifficulty = 'Easy' | 'Medium' | 'Hard';
export type InterviewStatus = 'lobby' | 'in_progress' | 'completed' | 'cancelled';
export type EmploymentType = 'Full-time' | 'Part-time' | 'Contract' | 'Internship';


export interface Plan {
  name: 'Free' | 'Plus' | 'Pro';
  price: number;
  description: string;
  features: string[];
  cta: string;
  ctaClass: string;
  highlight?: {
    text: string;
    color: 'blue' | 'green';
  };
}

// --- Database Table Types (Aligned with Schema) ---

export interface Language {
  id: string; // UUID in database
  name: string;
  code: string;
  is_active: boolean;
  created_at: string;
}

export interface Job {
  id: string;
  title: string;
  description: string;
  company_name?: string;
  location?: string;
  employment_type?: EmploymentType;
  salary_range?: string;
  requirements?: string[]; // Assuming jsonb
  created_by: string; // user_id
  created_at: string;
  updated_at?: string;
  is_active: boolean;
}

export interface Interview {
  id: string;
  user_id: string;
  candidate_name: string;
  position: string;
  jobDescription: string;
  mode: TInterviewMode;
  language: string;
  model: string;
  difficulty: InterviewDifficulty;
  status?: InterviewStatus;
  started_at?: string;
  ended_at?: string;
  duration_minutes?: number;
  overall_score?: number;
  video_url?: string;
  malpractice_report?: string;
  created_at: string;
  updated_at?: string;
}

export interface InterviewQuestion {
  id: string;
  interview_id: string;
  question_text: string;
  question_order?: number;
  asked_at: string;
  created_at: string;
}

export interface InterviewAnswer {
  id: string;
  interview_id: string; // Added: required in database
  question_id: string;
  answer_text?: string;
  answer_audio_url?: string;
  answer_video_url?: string;
  duration_seconds?: number;
  created_at: string;
  updated_at?: string;
}

export interface PerformanceReport {
  id: string;
  interview_id: string;
  candidate_id?: string;
  interviewer_id: string; // user_id
  overall_score?: number;
  technical_score?: number;
  communication_score?: number;
  problem_solving_score?: number;
  feedback?: string;
  recommendation?: string;
  created_at: string;
  updated_at?: string;
}

export interface Comment {
  id: string;
  interview_id: string;
  user_id: string;
  comment_text: string;
  is_internal: boolean;
  created_at: string;
  updated_at?: string;
  users?: { name: string }; // For joins
}

export interface ScreenShare {
  id: string;
  interview_id: string;
  recording_url?: string;
  started_at: string;
  ended_at?: string;
  duration_seconds?: number;
  file_size_mb?: number;
  created_at: string;
}

export enum AuditAction {
  // User actions
  USER_LOGIN = 'USER_LOGIN',
  USER_LOGOUT = 'USER_LOGOUT',
  USER_REGISTER = 'USER_REGISTER',
  USER_PROFILE_UPDATE = 'USER_PROFILE_UPDATE',
  USER_PLAN_CHANGE = 'USER_PLAN_CHANGE',
  // Interview actions
  INTERVIEW_CREATE = 'INTERVIEW_CREATE',
  INTERVIEW_FINALIZE = 'INTERVIEW_FINALIZE',
  INTERVIEW_SCHEDULE = 'INTERVIEW_SCHEDULE',
  // Report/Feedback actions
  REPORT_CREATE = 'REPORT_CREATE',
  COMMENT_CREATE = 'COMMENT_CREATE',
  // Application/Hiring actions
  APPLICATION_UPDATE_STATUS = 'APPLICATION_UPDATE_STATUS',
  // Compliance actions
  DATA_EXPORT = 'DATA_EXPORT',
  DATA_DELETE = 'DATA_DELETE',
}


export interface AuditLog {
  id: string;
  user_id: string;
  action: AuditAction | string;
  entity?: string;
  entity_id: string;
  table_name?: string;
  details?: {
    [key: string]: any;
  };
  created_at: string;
}


// --- Application-Specific Types ---

export interface InterviewSettings {
  candidateName: string;
  position: string;
  jobDescription: string;
  mode: TInterviewMode;
  language: string;
  model: string;
  difficulty: InterviewDifficulty;
}

export interface ModelSettings {
  chat: string;
  audio: string;
  video: string;
  liveShare: string;
  evaluation: string;
  questionGeneration: string;
}

export interface Question {
  id: string; // Corresponds to InterviewQuestion ID
  text: string;
}

export interface User {
  id: string; // From Supabase Auth
  name: string;
  email: string;
  interviewCount?: number;
}

export interface AiChatSession {
  sendMessage: (message: string) => Promise<string>;
}

export interface Metric {
    name: string;
    rating: number; // 1-10
    reasoning: string;
}

export interface FeedbackData {
    overallRating?: number;
    overallReasoning?: string;
    recommendation?: 'Recommended for Hire' | 'Needs Improvement' | 'Not a Fit';
    metrics?: Metric[];
    strengths?: string[];
    areasForImprovement?: string[];
}