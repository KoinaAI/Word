package app

// User is the public session profile; credentials never enter API responses.
type User struct {
	ID           int64  `json:"id"`
	Name         string `json:"name"`
	Email        string `json:"email"`
	Role         string `json:"role"`
	Guest        bool   `json:"guest"`
	DailyGoal    int    `json:"dailyGoal"`
	ExamDate     string `json:"examDate"`
	ActiveBookID int64  `json:"activeBookId"`
}

// Book includes progress counts for the current user.
type Book struct {
	ID           int64  `json:"id"`
	Title        string `json:"title"`
	Subtitle     string `json:"subtitle"`
	Description  string `json:"description"`
	Category     string `json:"category"`
	Color        string `json:"color"`
	WordCount    int    `json:"wordCount"`
	LearnedCount int    `json:"learnedCount"`
	DueCount     int    `json:"dueCount"`
}

// Word combines dictionary content with one user's learning state.
type Word struct {
	ID             int64  `json:"id"`
	BookID         int64  `json:"bookId"`
	Text           string `json:"text"`
	Phonetic       string `json:"phonetic"`
	Meaning        string `json:"meaning"`
	Example        string `json:"example"`
	ExampleMeaning string `json:"exampleMeaning"`
	Favorite       bool   `json:"favorite"`
	Status         string `json:"status"`
	Reinforce      bool   `json:"reinforce"`
	DueAt          string `json:"dueAt,omitempty"`
}

// Navigation configures only the four built-in administrative modules.
type Navigation struct {
	ID        int64  `json:"id"`
	Label     string `json:"label"`
	Path      string `json:"path"`
	Icon      string `json:"icon"`
	Enabled   bool   `json:"enabled"`
	SortOrder int    `json:"sortOrder"`
}
