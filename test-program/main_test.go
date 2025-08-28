package main

import (
	"testing"
)

func TestHello(t *testing.T) {
	expected := "Hello, World!"
	result := hello()
	if result != expected {
		t.Errorf("Expected %s, but got %s", expected, result)
	}
}

func TestAdd(t *testing.T) {
	result := add(2, 3)
	if result != 5 {
		t.Errorf("Expected 5, but got %d", result)
	}
}

func add(a, b int) int {
	return a + b
}
