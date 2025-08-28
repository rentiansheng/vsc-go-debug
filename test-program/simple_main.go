package main

import "fmt"

func main() {
	fmt.Println("Hello from test main!")

	for i := 0; i < 5; i++ {
		fmt.Printf("Count: %d\n", i)
	}

	fmt.Println("Program finished")
}
