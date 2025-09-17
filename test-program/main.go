package main

import (
	"fmt"
	"math/rand"
	"time"
)

type Person struct {
	Name string
	Age  int
}

func hello() string {
	return "Hello, World!"
}

func main() {
	fmt.Println("Go Debug Pro 测试程序开始")

	// 测试基本变量
	counter := 0
	message := "Hello Debug"
	fmt.Printf("开始调试: %s\n", message) // 第一个断点 - 第23行

	// 测试结构体
	person := Person{
		Name: "Alice",
		Age:  25,
	}
	fmt.Printf("Person: %+v\n", person) // 第二个断点 - 第30行

	// 测试数组和切片
	numbers := []int{1, 2, 3, 4, 5}
	scores := make(map[string]int)
	scores["math"] = 90
	scores["english"] = 85

	// 测试循环和条件断点
	for i := 0; i < 10; i++ {
		counter++

		// 在这里设置条件断点: i > 5
		if i > 5 {
			fmt.Printf("大于5的循环: i=%d, counter=%d\n", i, counter)
		}

		// 在这里设置 hit count 断点: %3 (每3次触发)
		processNumber(i)

		// 随机数测试
		randomValue := rand.Intn(100)
		if randomValue > 50 {
			fmt.Printf("随机值大于50: %d\n", randomValue)
		}

		time.Sleep(100 * time.Millisecond)
	}

	// 测试函数调用和调用栈
	result := calculateSum(numbers)
	fmt.Printf("数组和: %d\n", result)

	// 测试复杂对象
	updatePerson(&person)
	fmt.Printf("更新后的人员信息: %+v\n", person)

	// 测试错误处理
	divideResult, err := safeDivide(10, 0)
	if err != nil {
		fmt.Printf("除法错误: %v\n", err)
	} else {
		fmt.Printf("除法结果: %f\n", divideResult)
	}

	fmt.Println("程序结束")
}

func processNumber(num int) {
	// 在这里可以测试 watch 表达式
	doubled := num * 2
	squared := num * num

	fmt.Printf("数字 %d: 2倍=%d, 平方=%d\n", num, doubled, squared)
}

func calculateSum(numbers []int) int {
	sum := 0
	for _, num := range numbers {
		sum += num
		// 可以在这里观察 sum 变量的变化
	}
	return sum
}

func updatePerson(p *Person) {
	p.Age++
	p.Name = p.Name + " (Updated)"

	// 测试嵌套函数调用
	validateAge(p.Age)
}

func validateAge(age int) {
	if age < 0 {
		fmt.Println("年龄不能为负数")
	} else if age > 150 {
		fmt.Println("年龄过大")
	} else {
		fmt.Printf("年龄有效: %d\n", age)
	}
}

func safeDivide(a, b float64) (float64, error) {
	if b == 0 {
		return 0, fmt.Errorf("除数不能为零")
	}
	return a / b, nil
}
