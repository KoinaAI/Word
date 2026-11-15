package app

// User is the public session profile. Passwords and session secrets are never serialized.
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
	LearnStage     int    `json:"learnStage"`
	LearnRevision  int64  `json:"learnRevision"`
}

type Navigation struct {
	ID        string `json:"id"`
	Label     string `json:"label"`
	Path      string `json:"path"`
	Icon      string `json:"icon"`
	Enabled   bool   `json:"enabled"`
	SortOrder int    `json:"sortOrder"`
}

type Activity struct {
	Date  string `json:"date"`
	Count int    `json:"count"`
}

type Recent struct {
	ID        int64  `json:"id"`
	Text      string `json:"text"`
	Meaning   string `json:"meaning"`
	Answer    string `json:"answer"`
	CreatedAt string `json:"createdAt"`
}
